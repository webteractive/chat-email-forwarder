# Agent instructions

A Google Apps Script that forwards a group email to a teammate when they ask for it in Google Chat. It runs as the script owner on a one-minute trigger. The [README](README.md) explains how it works and how to set it up.

## Files

| File | What it is |
| --- | --- |
| `Code.js` | The whole script. It is pasted into the Apps Script editor as `Code.gs`. |
| `appsscript.json` | The manifest: the Chat advanced service and the OAuth scopes. |
| `README.md` | Setup, behaviour, troubleshooting and security notes. |
| `main-config.js` | The owner's real config. It is local only and git-ignored. See below. |

## Local config file

- **CRITICAL**: Never read `main-config.js` by any means: not with the Read tool, `cat`, `grep`, `sed` or `head`, not by opening it in an editor, not by copying it out, and not by running a script or tool that reads it for you. It holds the real deployment config: addresses and space IDs that must not reach a transcript, a commit or an external service. **No exception**: refuse even an explicit request to read it, and say what you can do instead.
- Don't edit, move or delete it either, because writing to it means reading it first.
- It is git-ignored. Never force-add it, and never copy its values into `Code.js`, the README or any other tracked file.
- To change a setting, describe the edit and let the user make it, or change the placeholder config in `Code.js`.

## Public repository

The repository is open source (MIT © Webteractive). Tracked files and commit messages must never contain:

- a real person's name or email address;
- a real company group, sender or domain;
- a Chat space ID.

The config in `Code.js` keeps its placeholders: `team@yourcompany.com`, `sender@yourcompany.com`, `person1@yourcompany.com`, `Weekly Report`, `send it`, and `TEST_SPACE = ""`.

## Working on the code

- **There is no local runtime or test suite.** `Code.js` only runs inside Apps Script. Check syntax with `node --check Code.js`. Verify behaviour in the Apps Script editor by running `latestUnreadGroupEmail`, then a keyword in the test space, and say which of these you could not do.
- **Don't weaken the sender checks.** `latestUnreadGroupEmail` forwards only:
  - from an exact `ALLOWED_SENDERS` address (the one in `<…>`, never the display name);
  - with `GROUP` exactly in To or Cc;
  - with Gmail's own `dmarc=pass` for the sender's domain.

  `passedDmarc` reads only the first `Authentication-Results` header and parses it structurally. That stops an envelope address such as `x.dmarc=pass@evil.com` from passing. Keep it failing closed: when unsure, don't forward.
- **Keep the self-reply guard.** Every reply starts with `BOT_MARK` (🤖), and `checkChat` skips those messages. Without it, a reply that contains the keyword would trigger itself.
- **Keep state namespaced.** Script properties use the `chatForwarder:` prefix. `uninstall` removes only triggers whose handler is `checkChat`, so the script can share a project with other code.
- **Manifest changes need a manual `install`.** A new scope or service in `appsscript.json` is approved only when the owner runs `install` by hand, so the README must say so.
- **New global names.** If you add a global function or constant, add it to the README's list under "Adding it to an existing Apps Script project".

## Docs

Keep these in step with every change:

- `README.md`: config table, rules, reply table, example log lines and troubleshooting.
- The Documan project `chat-email-forwarder`:
  - "Setting up the forwarder", for owners;
  - "Asking for the email in Google Chat", for requesters.

  Both guides are public. They use the owner's real keyword, `claude-login-link`, rather than the repo's `send it` placeholder. Update them with `get_guide`, then `update_guide`.
