# selfmend, in plain English

*For stakeholders, managers, and anyone who does not write code. No technical background needed.*

## The one-sentence version

selfmend keeps our automated tests from breaking every time a developer makes a small, harmless change to the website, while flatly refusing to ever hide a real problem.

## The problem it solves

We have automated tests. They click buttons, fill forms, and check that our product works, automatically, many times a day. They are how we catch bugs before customers do.

Those tests find things on the page using little address labels called "selectors" (for example, "the button with the name place-order"). Here is the catch: developers change those labels constantly during normal work. A redesign renames a button. A component gets restructured. The button still works perfectly for a real customer, but the test was looking for the old label, so the test fails.

This is the single biggest reason test suites become painful:

- A developer changes something harmless. The build goes red.
- A tester stops what they are doing to investigate, and finds nothing is actually broken. It was just a renamed label.
- Multiply that by every selector change, every week. Hours disappear into fixing tests that were never testing a real failure.
- Worse: when a suite cries wolf often enough, people stop trusting it. They start ignoring red builds. And that is exactly when a real bug slips through to a customer.

In short: we pay a constant tax in wasted time, and we slowly lose trust in the safety net that is supposed to protect us.

## What selfmend does

When a test passes, selfmend quietly remembers what each element looked like: its visible text, its role (a button, a link), its identifiers, where it sits on the page. Think of it as taking attendance.

Later, when a label changes and a test would normally fail, selfmend looks at the page and asks: "Is the thing I am looking for still here, just wearing a different label?" If it is clearly the same element, selfmend reconnects the test to it, the test passes, and it writes down exactly what it fixed and how sure it was.

A simple analogy: selfmend is the colleague who still recognises you after you change your haircut and glasses. Same person, different look, no problem. But, and this is the important part, if a total stranger walks in, that colleague will honestly say "I do not know who that is." selfmend will never pretend a stranger is you.

## The promise that makes it safe

This is the part that matters most to anyone responsible for quality:

**selfmend never fakes a passing test.**

It only reconnects a test when it is highly confident the element is genuinely the same one, and clearly not a look-alike. If it is not sure, it does nothing and the test fails normally, exactly as it would today. It would rather miss a fix and let you investigate than ever hide a real bug behind a false green checkmark.

So the worst case is "it did not help on this one, you handle it manually," never "it lied to you." That is a deliberate, designed-in guarantee, not a hope.

## What it costs and where our data goes

- **Cost: nothing.** It is free and open source (MIT licence). No subscription, no per-seat fee, no vendor.
- **Data: none leaves the building.** It runs entirely on our own machines and our own CI. It makes no internet calls, uses no external service, and sends nothing anywhere. What it remembers is a small plain text file we own and can read. Nothing about our product is exposed to a third party.

## What it does NOT do (so expectations are honest)

- It does not test new features for you. You still write the tests.
- It does not fix real bugs. If the product is genuinely broken, the test fails, as it should.
- It does not silently rewrite your tests behind your back. It reconnects at run time and reports it; the permanent cleanup stays a human decision.

It does one job well: it absorbs the constant churn of renamed labels so the team stops drowning in false alarms.

## See it for yourself (about 30 seconds)

Anyone can run the live demo from the project folder:

```
npm run demo
```

It tells a three-part story against a real (tiny) web page:

1. **Record.** A test passes today. selfmend takes attendance.
2. **Heal.** A "redesign" renames the button. The old test would break. selfmend recognises the button and keeps the test green, and reports exactly what it reconnected and how confident it was (you will see a score like 0.97).
3. **Trust check.** A different element is genuinely removed. selfmend refuses to fake it. The test fails, honestly. No false green.

That third act is the whole point of the product.

## The bottom line

- Less time wasted maintaining tests that broke for no real reason.
- Fewer false alarms, so the team keeps trusting the suite, which keeps it catching real bugs.
- Zero licensing cost and zero data leaving the company.
- A hard, designed-in guarantee that it will never hide a real failure.
