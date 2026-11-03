# Plan: "Lo" — the AI agent as a chat member

Goal: the AI agent is called **Lo**. In any Chat object, a user can talk to Lo like a member:
`@Lo` in a message (or replying to one of Lo's messages) makes Lo answer in the chat, with its
own name and avatar, streamed into the message as it is written.

## Constraint that shapes the design

The middleware signs every chat message with the account's identity (`creator`), and
`ChatMessage` has no metadata field. Lo has no account, so it cannot be a real participant.
Lo is therefore a **virtual member**: its messages are posted by the user's account and
carry an invisible marker; Loom renders marked messages as Lo.

- **Authorship marker:** Lo's message text ends with `LO_MARKER = '⁣​⁣'`
  (invisible). A suffix keeps mark ranges valid. `isLoMessage(m)` checks
  `content.text.endsWith(LO_MARKER)`; `stripLoMarker(text)` removes it. Other clients that
  don't know about the marker still see the message, posted by the owner.
- **Mention target:** mentions need an object id, so each space gets one "Lo" object
  (type `ot-loomAgent`, created on demand like `agentSession.ts` does for `ot-loomAgentChat`;
  remember its id in a hidden relation on the type, or find it by searching that type).
  A mention mark with `param == loObjectId` means "talking to Lo".

## Steps

1. **Rename the agent to Lo.**
   - UI strings in `src/json/text.json` (panel title, empty state, placeholder…) say "Lo".
   - `electron/ts/agent/policy.ts` `SYSTEM_PROMPT` starts "You are Lo, the assistant built into Loom…".
   - Constant `AGENT_NAME = 'Lo'` in a new `src/ts/lib/lo.ts`.
   - Avatar: a new `src/img/icon/lo.svg` (simple circle with "Lo"; uses `currentColor` or
     theme vars). Dark variant only if needed (run `/dark-mode-check`).

2. **`src/ts/lib/lo.ts`** (pure helpers + tests in `lo.test.ts`):
   - `LO_MARKER`, `isLoText`, `isLoMessage`, `stripLoMarker`, `withLoMarker`.
   - `mentionsLo(message, loId)`; `shouldLoReply(message, ctx)` (rules in step 5).
   - `buildChatHistory(messages, loId, limit = 30)`: earlier messages become agent history
     (Lo's → assistant, others → user prefixed with the author name).
   - `ensureLoObject(spaceId)`: cached per space; creates the type and the object if missing.

3. **Rendering Lo's messages** (`src/ts/component/block/chat/message/index.tsx`):
   - If `isLoMessage`: show Lo's name and avatar instead of the participant, place it on the
     "others" side (`isSelf = false`), strip the marker before rendering text. Hide the Edit
     action for Lo messages. Delete stays.
   - Strip the marker everywhere message text is shown as plain text: chat previews in the
     sidebar/widgets, notifications, reply previews, copy. Grep for `content.text` and
     `content?.text` usage.

4. **`@Lo` in the chat mention menu.** In the chat form's mention flow (`blockMention`
   opened from `component/block/chat/form.tsx`), add Lo as the first option when the filter
   matches "lo" or is empty, with Lo's avatar and the caption "AI agent". Selecting it inserts
   a normal mention mark with `param = loObjectId`. Show the mention with Lo's name. Do this
   only when the agent is configured (`S.Agent` status says a model is set); otherwise skip it.

5. **Replying** (new `src/ts/store/lo.ts` or a section of `S.Agent`; one controller per open chat):
   - Hook: where chat messages arrive (`dispatcher.ts` `ChatAdd`, or the chat block's
     subscription). Only **live** `ChatAdd` events count, not history loads.
   - Lo replies when **all** of these hold:
     - the message isn't Lo's own;
     - it mentions Lo, or replies to a Lo message;
     - `creator == S.Auth.account.id`. Lo answers only its owner's messages; this avoids two
       devices or two members both answering.
     - no Lo reply to it exists yet (`replyToMessageId == msg.id` with the marker), and it isn't
       already being answered in this session;
     - the agent is configured.
   - Flow:
     1. `C.ChatAddMessage(chatId, { content: { text: withLoMarker('…'), style: 0, marks: [] }, replyToMessageId: msg.id })`.
        This adds a placeholder.
     2. Start a run through the existing bridge. Use a separate agent chat key
        `lo:<chatObjectId>`, so the side panel's session isn't touched. Pass:
        - `text`: the message, with the `@Lo` mention removed;
        - `history`: from `buildChatHistory`;
        - `context`: the current chat object, plus the space and mentions as today.
     3. On text deltas, throttle `C.ChatEditMessageContent` to about one edit per 800 ms with the
        text so far plus the marker. Send a final edit on 'end'. On error, edit the message to a
        short error line (translated).
   - **Tools in chat runs:** read-only tools run. A change tool needs approval: show it in the
     message as "Lo wants to <label>" with Allow/Deny buttons. Only the owner sees the buttons,
     since only they own the run. Allow/Deny call `agentApprove`. If that is too heavy, a
     simpler fallback is acceptable: deny changes in chat runs, and have Lo say to use the
     side panel.
   - Stop: a Stop button on the streaming Lo message calls `agentStop` for that key.

6. **Electron side:** make sure `agentRun` / events support several concurrent chat keys
   (panel and Lo chats). `session.ts` is keyed by chatId already; check `index.ts` routes
   events by chatId to the renderer and that the renderer store dispatches by chatId, not
   only to the panel.

7. **Docs + tests:**
   - Unit tests for `lo.ts`, and for `shouldLoReply` and `buildChatHistory` edge cases.
   - Update `docs/src/ts/lib/README.md`, `docs/src/ts/store/README.md`,
     `docs/src/ts/component/block/README.md`, and the electron docs if routing changed.

## Verification (web mode)

Use the web mode already running at http://localhost:<vite port> with the stand-in model on :18999.

- Open a Chat object and type `@Lo` to check the menu shows Lo.
- Send `@Lo hello`. A Lo message should appear with Lo's name and avatar, then fill in.
- Reply to Lo's message without a mention. Lo should answer again.
- Reload the page. Lo's messages should still render as Lo and must not be answered again.
- Run `bun run typecheck`, `bun run lint` and `npx vitest run`. All must pass.

## Out of scope

- Lo as a real participant: that needs its own identity in the middleware.
- Lo answering other members' messages in shared spaces.
- Lo starting conversations on its own.
