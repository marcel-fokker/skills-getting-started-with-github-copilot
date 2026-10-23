const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.value = "";
    this.listeners = {};
    this.attributes = {};
    this.classList = { add() {}, remove() {} };
  }

  appendChild(child) {
    this.children.push(child);
  }

  set innerHTML(value) {
    this.html = value;
    this.children = [];
  }

  set length(value) {
    this.children.length = value;
  }

  addEventListener(event, handler) {
    this.listeners[event] = handler;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

test("participant cards render safely and refresh after signup and removal", async () => {
  const elements = Object.fromEntries(
    ["activities-list", "activity", "signup-form", "message", "email"].map(
      (id) => [id, new Element(id)]
    )
  );
  elements.activity.appendChild(new Element("option"));
  elements["signup-form"].reset = () => {
    elements.activity.value = "";
    elements.email.value = "";
  };
  const unsafeEmail = "<img src=x onerror=alert(1)>@example.com";
  const activities = {
    "Chess & Club": {
      description: "Play chess",
      schedule: "Fridays",
      max_participants: 12,
      participants: [unsafeEmail],
    },
    Art: {
      description: "Make art",
      schedule: "Mondays",
      max_participants: 20,
      participants: [],
    },
  };
  let failLoad = false;
  let deleteMode = "success";
  const deleteRequests = [];
  const errors = [];
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../src/static/app.js"), "utf8"),
    {
      document: {
        getElementById: (id) => elements[id],
        createElement: (tag) => new Element(tag),
        addEventListener: (_event, handler) => handler(),
      },
      fetch: async (url, options) => {
        if (options?.method === "DELETE") {
          deleteRequests.push(url);
          if (deleteMode === "network") throw new Error("Network unavailable");
          if (deleteMode === "error") {
            return {
              ok: false,
              json: async () => ({ detail: "Cannot remove participant" }),
            };
          }
          const parsed = new URL(url, "http://localhost");
          const email = parsed.searchParams.get("email");
          const participants = activities["Chess & Club"].participants;
          participants.splice(participants.indexOf(email), 1);
          return { ok: true, json: async () => ({ message: "Unregistered" }) };
        }
        if (options?.method === "POST") {
          activities.Art.participants.push(elements.email.value);
          return { ok: true, json: async () => ({ message: "Signed up" }) };
        }
        return {
          ok: !failLoad,
          status: failLoad ? 500 : 200,
          json: async () => activities,
        };
      },
      console: { error: (...args) => errors.push(args) },
      setTimeout() {},
    }
  );
  await new Promise(setImmediate);

  const section = (index) => elements["activities-list"].children[index].children[0];
  assert.equal(section(0).children[0].textContent, "Participants (1)");
  const list = section(0).children[1];
  assert.equal(list.tagName, "ul");
  assert.equal(list.children[0].tagName, "li");
  assert.equal(list.children[0].children[0].textContent, unsafeEmail);
  assert.equal(list.children[0].children[0].html, undefined);
  const deleteButton = list.children[0].children[1];
  assert.equal(deleteButton.type, "button");
  assert.equal(deleteButton.attributes["aria-label"],
    `Unregister ${unsafeEmail} from Chess & Club`);
  assert.match(deleteButton.html, /<svg/);
  assert.ok(!deleteButton.html.includes(unsafeEmail));
  assert.equal(section(1).children[1].textContent,
    "No participants yet. Be the first to sign up!");

  elements.activity.value = "Art";
  elements.email.value = "student@example.com";
  await elements["signup-form"].listeners.submit({ preventDefault() {} });
  assert.equal(section(1).children[0].textContent, "Participants (1)");
  assert.equal(section(1).children[1].children[0].children[0].textContent,
    "student@example.com");
  assert.match(elements["activities-list"].children[1].html, /19 spots left/);
  assert.equal(elements.activity.children.length, 3);

  deleteMode = "error";
  await deleteButton.listeners.click();
  assert.equal(elements.message.textContent, "Cannot remove participant");
  assert.equal(elements.message.className, "error");
  assert.equal(deleteButton.disabled, false);
  assert.equal(activities["Chess & Club"].participants.length, 1);

  deleteMode = "network";
  await deleteButton.listeners.click();
  assert.match(elements.message.textContent, /Failed to unregister participant/);
  assert.equal(deleteButton.disabled, false);
  assert.equal(activities["Chess & Club"].participants.length, 1);
  assert.equal(errors.length, 1);

  deleteMode = "success";
  elements.activity.value = "Art";
  const pendingDelete = deleteButton.listeners.click();
  assert.equal(deleteButton.disabled, true);
  await deleteButton.listeners.click();
  await pendingDelete;
  assert.equal(deleteRequests.length, 3);
  assert.equal(deleteRequests[2],
    `/activities/Chess%20%26%20Club/participants?email=${encodeURIComponent(unsafeEmail)}`);
  assert.equal(section(0).children[0].textContent, "Participants (0)");
  assert.equal(section(0).children[1].className, "participants-empty");
  assert.match(elements["activities-list"].children[0].html, /12 spots left/);
  assert.equal(elements.activity.value, "Art");
  assert.equal(elements.activity.children.length, 3);
  assert.equal(elements.message.textContent, "Unregistered");
  assert.equal(elements.message.className, "success");

  failLoad = true;
  await elements["signup-form"].listeners.submit({ preventDefault() {} });
  assert.match(elements["activities-list"].html, /Failed to load activities/);
  assert.equal(errors.length, 2);
});

test("participant list hides bullet points", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../src/static/styles.css"), "utf8"
  );
  assert.match(css, /\.participants-list\s*\{[^}]*list-style:\s*none;/);
});
