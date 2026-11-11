/**
 * Forward-on-request: when anyone in REQUESTERS asks in their Google Chat DM with you
 * (by typing KEYWORD), forward them the newest UNREAD email from one of ALLOWED_SENDERS,
 * sent to GROUP, whose subject starts with "PREFIX |", then mark that email read so it is
 * sent only once. Emails Gmail could not verify as genuine (DMARC) are never forwarded.
 * See README.md for the full setup.
 *
 * Runs as you on a one-minute time trigger, so it reads your Gmail and your Chat DMs.
 * Each requester must already have a DM with you (one message either way is enough).
 *
 * Setup
 *   1. script.google.com → new project → paste this file and appsscript.json
 *      (Project Settings → "Show appsscript.json manifest file in editor").
 *   2. Project Settings → Google Cloud Platform project → link a standard Cloud project
 *      with an Internal OAuth consent screen.
 *   3. In that Cloud project: enable the Google Chat API, and on its Configuration tab
 *      fill in an app name and avatar URL (required even for reading your own DMs).
 *   4. Fill in CONFIG below.
 *   5. Run latestUnreadGroupEmail once and check the log: it should show the right email
 *      (it only finds unread ones, so mark one unread in Gmail to test).
 *   6. Run install once: it authorizes Chat access and starts the every-minute check.
 *      After editing REQUESTERS you don't need to re-run install: new people are picked
 *      up on the next run.
 *
 * Testing: set TEST_SPACE to a space only you are in (its id is the last part of the
 * space's URL in Chat, e.g. chat.google.com/room/AAAAbc123 → 'spaces/AAAAbc123').
 * Typing KEYWORD there forwards the email to you. It uses up the unread email like a real
 * request, so mark it unread again in Gmail before the next test.
 *   If step 3 or 6 is blocked, your Workspace admin must allow the Cloud project / Chat API.
 */

// ===== CONFIG =====
const GROUP = "team@yourcompany.com"; // the group address the email is sent to
const ALLOWED_SENDERS = [
  // only emails From these addresses are forwarded, so nobody can plant a look-alike email
  "sender@yourcompany.com",
];
const PREFIX = "Weekly Report"; // subject text before the |
const REQUESTERS = [
  // who may ask; each gets the forward when they ask
  "person1@yourcompany.com",
  "person2@yourcompany.com",
];
const KEYWORD = "send it"; // what they type in Chat (case-insensitive)
const TEST_SPACE = ""; // optional: a space only you are in, e.g. 'spaces/AAAAbc123'.
// Typing KEYWORD there forwards the email to YOU. '' = off.
// ==================

// Script-property keys are namespaced so they can't clash with other code in the project.
const STATE = "chatForwarder:";

// Every reply the script posts starts with this, so it never mistakes its own reply for a request.
const BOT_MARK = "🤖";

/** Run once by hand: starts the one-minute check. Messages sent before this are ignored. */
function install() {
  uninstall();
  const props = PropertiesService.getScriptProperties();
  props
    .getKeys()
    .filter((k) => k.startsWith(STATE + "lastSeen:"))
    .forEach((k) => props.deleteProperty(k));
  props.setProperty(STATE + "installedAt", new Date().toISOString());
  ScriptApp.newTrigger("checkChat").timeBased().everyMinutes(1).create();
}

/** Run by hand to stop the check. Removes only checkChat triggers, so other triggers in the project are untouched. */
function uninstall() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "checkChat")
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * Checks each requester's DM (and TEST_SPACE, if set) for new messages containing KEYWORD
 * and forwards the email to whoever asked.
 */
function checkChat() {
  const props = PropertiesService.getScriptProperties();
  const fallback =
    props.getProperty(STATE + "installedAt") || new Date().toISOString();

  // Where to listen, and who gets the forward when a request appears there.
  // Both are looked up lazily, inside the try below, so one place failing can't stop the rest.
  const places = REQUESTERS.map((r) => ({
    label: r,
    recipient: () => r,
    space: () => dmWith(r, props),
  }));
  if (TEST_SPACE) {
    // Accept 'AAAA…', 'spaces/AAAA…', 'chat/AAAA…' or a pasted URL: the id is the last segment.
    const space = "spaces/" + TEST_SPACE.split("/").filter(Boolean).pop();
    places.push({
      label: "test-space",
      recipient: () => Session.getEffectiveUser().getEmail(),
      space: () => space,
    });
  }

  for (const place of places) {
    try {
      const space = place.space();
      const seenKey = STATE + "lastSeen:" + place.label.toLowerCase();
      const since = props.getProperty(seenKey) || fallback;

      const res = Chat.Spaces.Messages.list(space, {
        filter: `createTime > "${since}"`,
        orderBy: "createTime asc",
      });

      for (const msg of res.messages || []) {
        // Mark seen before acting, so a failure can't cause repeat forwards every minute.
        props.setProperty(seenKey, msg.createTime);
        const text = (msg.text || "").trim();
        if (text.startsWith(BOT_MARK)) continue; // the script's own reply
        if (!text.toLowerCase().includes(KEYWORD.toLowerCase())) continue;

        // Searched fresh for each request: an email forwarded a moment ago is now read.
        const email = latestUnreadGroupEmail();
        if (!email) {
          reply(space, "No new email to send right now.");
          continue;
        }

        email.forward(place.recipient());
        email.markRead(); // only after the forward succeeded, so a failed send stays unread
        reply(
          space,
          `Sent ✅ "${email.getSubject()}" (${email.getDate().toDateString()}), check your inbox.`,
        );
      }
    } catch (e) {
      // One place's problem (e.g. no DM with you yet) must not block everyone else.
      console.error(`${place.label}: ${e.message}`);
    }
  }
}

/** Posts a reply marked with BOT_MARK so the script recognizes it as its own. */
function reply(space, text) {
  Chat.Spaces.Messages.create({ text: `${BOT_MARK} ${text}` }, space);
}

/** The DM space between you and requester, cached so it's looked up only once. */
function dmWith(requester, props) {
  const key = STATE + "space:" + requester.toLowerCase();
  let space = props.getProperty(key);
  if (!space) {
    space = Chat.Spaces.findDirectMessage({ name: "users/" + requester }).name;
    props.setProperty(key, space);
  }
  return space;
}

/**
 * Newest UNREAD email from one of ALLOWED_SENDERS, sent to GROUP, whose subject starts with
 * "PREFIX |" (skips Re:/Fwd: replies), and which Gmail verified as genuine (passedDmarc).
 */
function latestUnreadGroupEmail() {
  const group = GROUP.toLowerCase();
  const senders = ALLOWED_SENDERS.map((s) => s.toLowerCase());
  if (!senders.length) {
    // Fail closed: with no sender check, anyone could plant an email for the script to forward.
    console.error("ALLOWED_SENDERS is empty; refusing to forward anything");
    return undefined;
  }

  const from = senders.map((s) => `from:${s}`).join(" ");
  const threads = GmailApp.search(
    `to:${GROUP} {${from}} subject:"${PREFIX}" is:unread`,
    0,
    20,
  );
  const latest = threads
    .flatMap((t) => t.getMessages())
    .filter((m) => m.isUnread()) // the search matches whole conversations; check each message
    .filter((m) => m.getSubject().includes("|"))
    .filter((m) => m.getSubject().split("|")[0].trim() === PREFIX)
    .filter((m) => senders.includes(senderOf(m.getFrom())))
    .filter((m) => addressesIn(m.getTo() + "," + m.getCc()).includes(group))
    .filter((m) => {
      // Last, because it reads the whole raw email: only the few candidates left pay for it.
      if (passedDmarc(m)) return true;
      console.warn(`Skipped, failed DMARC (possible forgery): ${m.getDate()} — ${m.getSubject()} — ${m.getFrom()}`);
      return false;
    })
    .sort((a, b) => b.getDate() - a.getDate())[0];

  console.log(
    latest
      ? `${latest.getDate()} — ${latest.getSubject()}`
      : "No matching unread email found",
  );
  return latest;
}

/**
 * True only when Gmail itself verified that the email really comes from its sender's domain.
 *
 * The From line is just text anyone can type, and a domain whose DMARC policy is p=none still has
 * forged mail delivered. But Gmail records its verdict on every email it receives, as an
 * Authentication-Results header added ABOVE all the headers that arrived with the email. Only that
 * first header is read, so one a forger wrote into their own email further down is ignored. It
 * must come from mx.google.com, say dmarc=pass, and name the sender's own domain in header.from.
 */
function passedDmarc(message) {
  const raw = message.getRawContent();
  const end = raw.search(/\r?\n\r?\n/);
  const headers = (end === -1 ? raw : raw.slice(0, end)).replace(/\r?\n[ \t]+/g, " "); // unfold
  const first = headers.match(/^Authentication-Results:[ \t]*(.*)$/im);
  if (!first) return false;

  const verdict = first[1].toLowerCase();
  const domain = senderOf(message.getFrom()).split("@")[1] || "";
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    domain !== "" &&
    verdict.startsWith("mx.google.com;") &&
    /\bdmarc=pass\b/.test(verdict) &&
    new RegExp(`header\\.from=${escaped}(?![\\w.-])`).test(verdict)
  );
}

/**
 * The real sender address in a From header, lowercased. Takes the address inside <…>, never the
 * display name, so `"boss@x.com" <attacker@y.com>` yields attacker@y.com.
 */
function senderOf(header) {
  const h = (header || "").trim();
  const bracketed = h.match(/<([^<>]+)>\s*$/);
  return (bracketed ? bracketed[1] : h).trim().toLowerCase();
}

/**
 * Bare, lowercased email addresses in a To/Cc header such as `"Doe, Jane" <jane@x.com>, bob@y.com`.
 * Quoted display names are dropped first, and matching is exact, so team@x.com does not match
 * myteam@x.com.
 */
function addressesIn(header) {
  const unquoted = (header || "").replace(/"[^"]*"/g, "");
  return (unquoted.match(/[^\s<>,;']+@[^\s<>,;']+/g) || []).map((a) =>
    a.toLowerCase(),
  );
}
