# Library lending REST API

A compact, runnable demonstration of book availability, holds, and overdue reminders. It uses only Node.js built-ins and in-memory sample data; restart the server to reset its data. Run with `node server.js` (default `http://localhost:3000`; override with `PORT`).

## Endpoints

| Method and path | Purpose | Success |
| --- | --- | --- |
| `GET /books/{bookId}/availability` | Read total and available copies and active hold count. | `200` |
| `POST /books/{bookId}/holds` | Create a hold for a member. | `201` |
| `GET /holds/{holdId}` | Retrieve a hold and its queue status. | `200` |
| `POST /loans/{loanId}/reminders` | Queue an overdue reminder. | `202` |

### Request and response shapes

`GET /books/bk-101/availability` returns:

```json
{
  "bookId": "bk-101",
  "title": "The Left Hand of Darkness",
  "totalCopies": 2,
  "availableCopies": 0,
  "activeHolds": 0
}
```

`POST /books/bk-101/holds` accepts `{"memberId":"member-100"}` and returns a hold with `id`, `bookId`, `memberId`, `status` (`queued` or `ready`), `queuePosition` (null when ready), and `createdAt`.

`GET /holds/{holdId}` returns that same hold representation.

`POST /loans/loan-201/reminders` accepts `{"channel":"email"}` (`email` or `sms`) and returns a queued reminder with `id`, `loanId`, `memberId`, `channel`, `status`, and `createdAt`. `202 Accepted` means queued for delivery; this demo does not send email or SMS.

## Validation and errors

- Hold requests require a non-empty `memberId` belonging to a known member. A member can have only one non-cancelled hold per book.
- Reminder requests require an `email` or `sms` channel, and the loan must be overdue.
- Malformed JSON or invalid fields return `400`; a missing book/member/hold/loan returns `404`; duplicate active holds and reminders for not-yet-overdue loans return `409`; request bodies over 16 KB return `413`.
- Errors use `{"error":{"code":"...","message":"..."}}`. Example duplicate-hold response: `409 Conflict` with `{"error":{"code":"active_hold_exists","message":"This member already has an active hold for this book."}}`.

## Implementation note

Availability is read from the book record; a newly created hold is queued when no copy is free, or marked ready and reserves one copy otherwise. Hold position is the active queue length plus one. Reminder creation checks the loan due date and records a queued reminder. The sample book (`bk-101`) has zero available copies; members `member-100` and `member-200` are known; `loan-201` is seeded overdue. Data, queues, and delivery state are deliberately in memory. A production service should persist updates transactionally, enforce the active-hold uniqueness rule in storage, authenticate/authorize callers, and deliver reminders through a background worker.

## curl test evidence

Started `node server.js` and exercised each route with `curl.exe` on Windows PowerShell. PowerShell's native argument quoting can alter inline JSON, so the POST requests below use temporary JSON files. The shown responses are from the completed run; UUIDs and timestamps are generated at request time.

```powershell
$holdFile = Join-Path $env:TEMP 'hold.json'
$reminderFile = Join-Path $env:TEMP 'reminder.json'
[IO.File]::WriteAllText($holdFile, '{"memberId":"member-100"}', [Text.Encoding]::ASCII)
[IO.File]::WriteAllText($reminderFile, '{"channel":"email"}', [Text.Encoding]::ASCII)

curl.exe -i http://localhost:3000/books/bk-101/availability
$holdJson = curl.exe -sS -X POST http://localhost:3000/books/bk-101/holds -H 'Content-Type: application/json' --data-binary "@$holdFile" | Out-String
$hold = $holdJson | ConvertFrom-Json
$hold
curl.exe -i "http://localhost:3000/holds/$($hold.id)"
curl.exe -i -X POST http://localhost:3000/loans/loan-201/reminders -H 'Content-Type: application/json' --data-binary "@$reminderFile"
curl.exe -i -X POST http://localhost:3000/books/bk-101/holds -H 'Content-Type: application/json' --data-binary "@$holdFile"

Remove-Item $holdFile, $reminderFile
```

Observed results: availability `200 OK` (2 total, 0 available); hold creation `201 Created` (queued, position 1); hold lookup `200 OK`; reminder creation `202 Accepted` (queued); repeating the same hold `409 Conflict` with `{"error":{"code":"active_hold_exists","message":"This member already has an active hold for this book."}}`. A second member's hold returned queue position 2, and a 17 KB body returned `413 Payload Too Large`. The edge case verifies that one member cannot create duplicate active holds for the same book.
