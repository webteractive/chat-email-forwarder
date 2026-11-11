# Chat Email Forwarder

A Google Apps Script that forwards an email to a teammate when they ask for it in Google Chat.

A requester types a keyword (for example `send it`) in their 1:1 Chat DM with you. Within about a minute, the script finds the newest **unread** email from an allowed sender, sent to a group address, whose subject starts with a fixed prefix, forwards it from your Gmail to that requester only, marks it read, and replies in the DM to confirm.

## How it works

```
 Requester              Google Chat            Apps Script               Your Gmail
 (on the list)          (your 1:1 DM)          (runs as YOU, every 1 min)
     │ 1. types "send it"    │                        │                       │
     │──────────────────────>│                        │                       │
     │                       │  2. for each requester: new messages since     │
     │                       │<───────────────────────│     the last check?   │
     │                       │───────────────────────>│                       │
     │                       │       3. contains the keyword? no → skip       │
     │                       │                        │ 4. newest unread      │
     │                       │                        │    matching email     │
     │                       │                        │──────────────────────>│
     │                       │                        │<──────────────────────│
     │ 5. forward, to the requester only, then the email is marked read       │
     │<═══════════════════════════════════════════════│                       │
     │ 6. "🤖 Sent ✅ <subject> (<date>)"             │                       │
     │<──────────────────────│<───────────────────────│                       │
```

The script runs entirely as you, on a one-minute time trigger. It reads your Gmail and your Chat DMs; nothing runs as the requesters, and no Chat bot is installed.

### Which email is sent

1. Gmail search: from one of `ALLOWED_SENDERS`, sent to `GROUP`, subject contains `PREFIX`, unread.
2. Keep only unread messages whose subject, up to the `|`, is exactly `PREFIX`. This drops `Re:` and `Fwd:` replies.
3. Keep only messages whose sender address, the one inside `<…>` and never the display name, is exactly one of `ALLOWED_SENDERS`.
4. Keep only messages with `GROUP` exactly in To or Cc, so `team@…` does not match `myteam@…`.
5. Take the newest.

### Rules it follows

- **First to ask gets it.** Forwarding marks the email read, so later requests get `🤖 No new email to send right now.` until a new one arrives.
- **Only the person who asked receives it.** The forward goes to that requester's address alone. Copies stay in your Sent folder.
- **Only emails from listed senders are forwarded.** If `ALLOWED_SENDERS` is empty, nothing is forwarded at all.
- **Only listed people can ask.** DMs from anyone not in `REQUESTERS`, and messages in group chats, are never read.
- **Opening the email yourself marks it read**, and the script will then skip it.
- **Each message is handled once.** The time of the last checked message is stored per requester.
- **The script ignores its own replies.** They start with 🤖.

## Setup

You need a Google Workspace account that receives the group's emails. You also need permission to create, or edit, a Google Cloud project in your organization.

### 1. Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) and create a new project.
2. Replace the contents of `Code.gs` with [`Code.js`](Code.js).
3. Go to **Project Settings** (the gear icon) and tick **Show "appsscript.json" manifest file in editor**.
4. Back in the editor, replace the contents of `appsscript.json` with [`appsscript.json`](appsscript.json). Change `timeZone` if you're not in `Asia/Manila`. Save.

### 2. Link a Google Cloud project

1. In the [Cloud console](https://console.cloud.google.com), create a project or pick an existing one. Copy its **project number**, not the project ID.
2. Go to **APIs & Services → OAuth consent screen** (also called **Google Auth Platform**) and set it up with user type **Internal**.
   An External project still in Testing loses its access every 7 days, which silently stops the trigger.
3. In Apps Script, go to **Project Settings → Google Cloud Platform (GCP) Project → Change project**, paste the project number and click **Set project**.

### 3. Enable and configure the Chat API

1. In the Cloud console, go to **APIs & Services → Library → Google Chat API → Enable**.
2. Click **Manage**, then the **Configuration** tab. Enter an app name, an avatar URL (any image) and a description, and turn **Interactive features** off. Save.
   Google requires this configuration even though the script only reads your own DMs. If the project already has a configured Chat app, leave its configuration as it is.

### 4. Fill in the config

At the top of `Code.gs`:

| Setting | What to put |
| --- | --- |
| `GROUP` | The group address the email is sent to. |
| `ALLOWED_SENDERS` | The address or addresses the real email comes from. Open the email in Gmail and use the address in `<…>` next to the sender's name. If it shows as "Name via Group", Google Groups has rewritten the sender to the group address; put the group address here. |
| `PREFIX` | The subject text before the `\|`. Matching is case-sensitive. |
| `REQUESTERS` | Email addresses of the people allowed to ask. Each must already have a 1:1 DM with you. |
| `KEYWORD` | What they type in Chat. Matching is case-insensitive, and the keyword can appear anywhere in the message. |
| `TEST_SPACE` | Optional. A Chat space only you are in, used for testing (see below). Use `''` to turn it off. |

### 5. Check it finds the right email

Mark a matching email **unread** in Gmail. Then pick `latestUnreadGroupEmail` in the function dropdown and click **Run**. Approve the permission prompt. The **Execution log** should show that email's date and subject.

### 6. Start it

Pick `install` and click **Run**. This starts the one-minute trigger. Messages sent before this moment are ignored.

Run `install` by hand again whenever `appsscript.json` changes. Timed runs can't show a permission prompt, so new permissions are only approved when you run something yourself.

## Testing

Set `TEST_SPACE` to a Chat space that only you are in. Its ID is the last part of the space's URL, for example `chat.google.com/room/AAAAbc123`. You can paste the bare ID, `spaces/AAAAbc123`, or the URL. Typing the keyword there forwards the email **to you**.

A test uses up the unread email just as a real request does, so mark it unread again before the next test or before real requests.

## Checking that it works

- **Triggers** (alarm-clock icon): one `checkChat` trigger, time-driven, every minute.
- **Executions** (list icon): a `checkChat` run about every minute with status **Completed**. A run with an empty log is normal when nobody asked for anything.
- **End to end:** type the keyword in the test space. Check that you get the forward, a `🤖 Sent ✅` reply, and the original now marked read. Type it again, and you should get `🤖 No new email to send right now.`

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Specified permissions are not sufficient…` | The online `appsscript.json` is out of date, or the new permission hasn't been approved. Update the manifest, then run `install` by hand. |
| `person@…: Requested entity was not found` in the log | That requester has no 1:1 DM with you, or the address is wrong. Everyone else is still checked. |
| `🤖 No new email to send right now.` | No unread email matches. It was already sent or opened, or `PREFIX`, `GROUP` or `ALLOWED_SENDERS` doesn't match. Run `latestUnreadGroupEmail` to see what it finds. |
| `ALLOWED_SENDERS is empty` in the log | Add the sender address. The script refuses to forward anything without one. |
| Nothing happens after 2 minutes | Open the newest row in **Executions** and read the error. |
| Linking the Cloud project or enabling the Chat API is blocked | A Workspace admin must allow the Cloud project or the Chat API. |

## Stopping it

Run `uninstall`. It removes only this script's `checkChat` trigger, so other triggers in the project are untouched.

## Adding it to an existing Apps Script project

Add `Code.js` as a new script file. First check that the project doesn't already define the same global names (`GROUP`, `ALLOWED_SENDERS`, `PREFIX`, `REQUESTERS`, `KEYWORD`, `TEST_SPACE`, `STATE`, `BOT_MARK`, `install`, `uninstall`, `checkChat`, `reply`, `dmWith`, `latestUnreadGroupEmail`, `senderOf`, `addressesIn`). Merge `appsscript.json` rather than replacing it: add the `Chat` advanced service, and add the five scopes to any existing `oauthScopes` list. The script's saved state uses script properties prefixed with `chatForwarder:`.

## Security

The forward comes from your own account, so requesters will trust whatever it contains. That makes it worth stopping anyone from planting a look-alike email for the script to pick up:

- **The sender check** is the main guard. Without it, anyone could email you with a fake `To:` of the group address and the right subject.
- **The From address can still be forged** by an outsider. Gmail rejects or spam-folders forged mail from your own domain when the domain publishes a DMARC policy of `quarantine` or `reject`. Ask your admin to confirm yours does, especially if `ALLOWED_SENDERS` holds an address in your domain or the group address itself. Spam-foldered mail is never picked, because Gmail search skips Spam.
- **Requests are limited** to the people in `REQUESTERS`, and each forward goes only to the person who asked.

## Limits

Each requester adds one or two Chat API calls to every one-minute run. Google caps a script's total trigger runtime per day, so this suits up to about 15 requesters. Beyond that, a shared space with sender lookup would scale better.

## License

[MIT](LICENSE) © Webteractive
