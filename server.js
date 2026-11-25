const http = require("node:http");
const { randomUUID } = require("node:crypto");

const books = new Map([
  ["bk-101", { id: "bk-101", title: "The Left Hand of Darkness", totalCopies: 2, availableCopies: 0 }],
]);
const members = new Set(["member-100", "member-200"]);
const holds = new Map();
const loans = new Map([
  ["loan-201", { id: "loan-201", memberId: "member-100", bookId: "bk-101", dueAt: "2025-01-10T00:00:00.000Z" }],
]);
const reminders = new Map();

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > 16 * 1024) {
        tooLarge = true;
        body = "";
        reject(new HttpError(413, "payload_too_large", "Request body must be 16 KB or smaller."));
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, "invalid_json", "Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function activeHoldsForBook(bookId) {
  return [...holds.values()].filter((hold) => hold.bookId === bookId && hold.status !== "cancelled");
}

async function handleRequest(request, response) {
  const url = new URL(request.url, "http://localhost");
  let match;

  if (request.method === "GET" && (match = url.pathname.match(/^\/books\/([^/]+)\/availability$/))) {
    const book = books.get(match[1]);
    if (!book) throw new HttpError(404, "book_not_found", "Book was not found.");
    return sendJson(response, 200, {
      bookId: book.id,
      title: book.title,
      totalCopies: book.totalCopies,
      availableCopies: book.availableCopies,
      activeHolds: activeHoldsForBook(book.id).length,
    });
  }

  if (request.method === "POST" && (match = url.pathname.match(/^\/books\/([^/]+)\/holds$/))) {
    const book = books.get(match[1]);
    if (!book) throw new HttpError(404, "book_not_found", "Book was not found.");

    const body = await readJson(request);
    if (!body || typeof body.memberId !== "string" || !body.memberId.trim()) {
      throw new HttpError(400, "invalid_request", "memberId is required and must be a non-empty string.");
    }
    const memberId = body.memberId.trim();
    if (!members.has(memberId)) throw new HttpError(404, "member_not_found", "Member was not found.");
    if ([...holds.values()].some((hold) => hold.bookId === book.id && hold.memberId === memberId && hold.status !== "cancelled")) {
      throw new HttpError(409, "active_hold_exists", "This member already has an active hold for this book.");
    }

    const activeHolds = activeHoldsForBook(book.id);
    const queuedHolds = activeHolds.filter((hold) => hold.status === "queued");
    const canReserveCopy = book.availableCopies > 0 && queuedHolds.length === 0;
    const hold = {
      id: randomUUID(),
      bookId: book.id,
      memberId,
      status: canReserveCopy ? "ready" : "queued",
      queuePosition: canReserveCopy ? null : queuedHolds.length + 1,
      createdAt: new Date().toISOString(),
    };
    if (hold.status === "ready") book.availableCopies -= 1;
    holds.set(hold.id, hold);
    return sendJson(response, 201, hold);
  }

  if (request.method === "GET" && (match = url.pathname.match(/^\/holds\/([^/]+)$/))) {
    const hold = holds.get(match[1]);
    if (!hold) throw new HttpError(404, "hold_not_found", "Hold was not found.");
    return sendJson(response, 200, hold);
  }

  if (request.method === "POST" && (match = url.pathname.match(/^\/loans\/([^/]+)\/reminders$/))) {
    const loan = loans.get(match[1]);
    if (!loan) throw new HttpError(404, "loan_not_found", "Loan was not found.");
    if (new Date(loan.dueAt) >= new Date()) {
      throw new HttpError(409, "loan_not_overdue", "A reminder can only be created for an overdue loan.");
    }

    const body = await readJson(request);
    if (!body || !["email", "sms"].includes(body.channel)) {
      throw new HttpError(400, "invalid_request", "channel is required and must be email or sms.");
    }
    const reminder = {
      id: randomUUID(),
      loanId: loan.id,
      memberId: loan.memberId,
      channel: body.channel,
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    reminders.set(reminder.id, reminder);
    return sendJson(response, 202, reminder);
  }

  throw new HttpError(404, "not_found", "Endpoint was not found.");
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (response.headersSent || response.destroyed) return;
    if (error instanceof HttpError) {
      return sendJson(response, error.status, { error: { code: error.code, message: error.message } });
    }
    console.error(error);
    return sendJson(response, 500, { error: { code: "internal_error", message: "An unexpected error occurred." } });
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`Library API listening on http://localhost:${port}`));
