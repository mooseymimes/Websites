/* Debt Shield — company screening, settlement checks, complaint builder.
   Everything runs locally; state is kept in localStorage when available. */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const usd = (n, cents = false) => (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const pct = (n, d = 0) => (Number.isFinite(n) ? (n * 100).toFixed(d) : "—") + "%";
  const num = (v) => { const n = parseFloat(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : NaN; };

  /* ---------- storage (best effort) ---------- */
  const KEY = "debt-shield:v1";
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
    save(data) { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode etc. */ } },
    clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };
  const state = Object.assign({ company: "", answers: {}, settle: null, theme: null }, store.load());
  const persist = () => store.save(state);

  /* ---------- theme ---------- */
  const root = document.documentElement;
  if (state.theme) root.dataset.theme = state.theme;
  $("#themeToggle").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    state.theme = dark ? "light" : "dark";
    root.dataset.theme = state.theme;
    persist();
  });

  /* ---------- icons ---------- */
  const ICON = {
    violation: '<svg class="finding__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 8.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    flag: '<svg class="finding__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4m0 3v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    verify: '<svg class="finding__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7m0 3v.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    info: '<svg class="finding__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6m0-10v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    ok: '<svg class="finding__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const TAG = { violation: "Potential violation", flag: "Red flag", verify: "Find out", info: "Good to know", ok: "Looks right" };
  const finding = (f, heading = "h4") => `
    <div class="finding finding--${f.type === "info" ? "verify" : f.type}">
      ${ICON[f.type]}
      <span class="finding__tag">${TAG[f.type]}</span>
      <${heading}>${f.title}</${heading}>
      <div>${f.body ? `<p>${f.body}</p>` : ""}${f.cite ? `<cite>${f.cite}</cite>` : ""}</div>
    </div>`;

  /* =========================================================
     TOOL 1 — COMPANY CHECK
     ========================================================= */
  const nameInput = $("#companyName");
  nameInput.value = state.company || "";
  const companyName = () => nameInput.value.trim();

  const LOOKUPS = [
    { title: "Virginia SCC license", desc: "Is it on the SCC's list of licensed debt settlement services providers?",
      url: () => "https://www.google.com/search?q=" + encodeURIComponent("site:scc.virginia.gov debt settlement services providers licensees"), always: true },
    { title: "Virginia business registration", desc: "SCC Clerk's Information System — is the entity registered and active?",
      url: () => "https://cis.scc.virginia.gov/EntitySearch/Index", always: true },
    { title: "CFPB complaints", desc: "Federal complaint database — look for patterns in what people report.",
      url: (q) => "https://www.consumerfinance.gov/data-research/consumer-complaints/search/?searchField=all&searchText=" + encodeURIComponent(q) },
    { title: "CFPB enforcement", desc: "Has the Consumer Financial Protection Bureau taken action?",
      url: (q) => "https://www.consumerfinance.gov/enforcement/actions/?title=" + encodeURIComponent(q) },
    { title: "FTC cases", desc: "Federal Trade Commission cases and proceedings.",
      url: (q) => "https://www.ftc.gov/legal-library/browse/cases-proceedings?search_api_fulltext=" + encodeURIComponent(q) },
    { title: "Virginia Attorney General", desc: "Settlements and lawsuits announced by the Virginia OAG.",
      url: (q) => "https://www.google.com/search?q=" + encodeURIComponent(`site:oag.state.va.us "${q}"`) },
    { title: "Better Business Bureau", desc: "Rating, complaint history, and how the company responds.",
      url: (q) => "https://www.bbb.org/search?find_country=USA&find_text=" + encodeURIComponent(q) },
    { title: "Lawsuits & orders", desc: "News of lawsuits, consent orders, or cease-and-desist orders.",
      url: (q) => "https://www.google.com/search?q=" + encodeURIComponent(`"${q}" (lawsuit OR "consent order" OR "cease and desist" OR "attorney general")`) },
    { title: "Licenses in other states", desc: "NMLS Consumer Access — many states license debt settlement here.",
      url: () => "https://www.nmlsconsumeraccess.org/", always: true },
  ];

  function renderLookups() {
    const q = companyName();
    $("#lookups").innerHTML = LOOKUPS.map((l, i) => {
      const live = l.always || q;
      return `<li><a class="lookup" ${live ? `href="${esc(l.url(q))}"` : 'aria-disabled="true"'} target="_blank" rel="noopener">
        <span class="lookup__num" aria-hidden="true">${i + 1}</span>
        <span><strong>${l.title} ↗</strong><span>${live ? l.desc : "Enter the company name above first."}</span></span>
      </a></li>`;
    }).join("");
  }

  /* Each question: which answer is the problem ("bad"), how serious, and why. */
  const VA_LIC = "Va. Code § 6.2-2027";
  const GROUPS = [
    { name: "Licensing & reputation", qs: [
      { id: "licensed", bad: "no", sev: "violation",
        q: "Is the company on the Virginia SCC's list of licensed debt settlement services providers?",
        sub: "Exempt: banks, credit unions, and Virginia-licensed attorneys. Use lookup 1.",
        title: "Not licensed to settle debts for Virginians",
        body: "Anyone providing debt settlement services to Virginia residents must hold an SCC license, even with no Virginia office — unless it is a bank, savings institution, credit union, or a Virginia-licensed attorney.",
        cite: VA_LIC, ask: "Ask for its Virginia SCC debt settlement license number and confirm it with the Bureau of Financial Institutions at (804) 371-9657." },
      { id: "enforcement", bad: "yes", sev: "flag",
        q: "Did your lookups find a government enforcement action, lawsuit, or order against the company or its owners?",
        title: "Past enforcement action or lawsuit",
        body: "Regulators and courts have already raised concerns about this company or its people. Read the order: it may describe the same practices you're experiencing, and some orders still bind the company.",
        cite: "CFPB, FTC, Virginia OAG, and court records", ask: "Run lookups 3–8 and read any orders you find." },
      { id: "complaints", bad: "yes", sev: "flag",
        q: "Did you find a pattern of similar complaints — fees taken without results, ignored cancellations, surprise lawsuits?",
        title: "A pattern of similar complaints",
        body: "Repeated complaints about the same problem suggest it's a practice, not a one-off. Note how the company responded.",
        cite: "CFPB complaint database · BBB", ask: "Skim the CFPB database and BBB for repeated themes." },
    ]},
    { name: "Fees", qs: [
      { id: "advanceFee", bad: "yes", sev: "violation",
        q: "Did the company ask for or take any fee before it settled a debt and you made a payment under that settlement?",
        sub: "Include fees taken from your dedicated account.",
        title: "Fees collected before a debt was settled",
        body: "A debt settlement company may not request or receive a fee until it has settled at least one debt under an agreement you signed and you have made at least one payment under that settlement. Virginia's licensing law has the same rule.",
        cite: "16 CFR 310.4(a)(5)(i) · Va. Code § 6.2-2040", ask: "Ask for a ledger of every fee taken from you or your account, with the date of each and the settlement it relates to." },
      { id: "otherFees", bad: "yes", sev: "violation",
        q: "Does the company charge you any fee besides its settlement fee — enrollment, setup, monthly service, or 'admin' fees?",
        sub: "Fees charged by the bank holding your account are a separate question.",
        title: "Extra fees on top of the settlement fee",
        body: "A Virginia licensee may not charge or receive any fee or compensation for debt settlement services other than the capped settlement fee. Under federal law, monthly or enrollment fees collected before debts settle are banned advance fees.",
        cite: "Va. Code § 6.2-2041(C) · 16 CFR 310.4(a)(5)(i)", ask: "Ask for a complete written fee schedule." },
      { id: "feeCap", bad: "yes", sev: "violation",
        q: "Is the fee more than 20% of the debt you enrolled, or more than 30% of the amount saved?",
        sub: "Not sure? Run your numbers in Tool 2.",
        title: "Fee above Virginia's cap",
        body: "A licensee's total fee may be no more than 20% of the principal of the debt you enrolled, or no more than 30% of the difference between what you owed when the debt was settled and what you paid to satisfy it.",
        cite: "Va. Code § 6.2-2041(A)–(B)", ask: "Check your contract's fee terms, then run the numbers in the settlement checker below." },
      { id: "feeDisclosed", bad: "no", sev: "violation",
        q: "Before you signed, did the company clearly tell you the total cost and how the fee is calculated?",
        title: "Total cost not disclosed up front",
        body: "Telemarketers must disclose the total cost of the service before you pay, and a debt relief company's fee must be either proportional to each debt's share of the total or a fixed percentage of the amount saved.",
        cite: "16 CFR 310.3(a)(1)(i), 310.4(a)(5)(i)(C)", ask: "Ask for the fee formula in writing and an estimate of total fees in dollars." },
    ]},
    { name: "Your money", qs: [
      { id: "account", bad: "no", sev: "violation",
        q: "Is your savings held in an account at an FDIC-insured bank that you own, including any interest?",
        title: "Your savings aren't in an insured account you own",
        body: "If a company has you save in a dedicated account, the account must be at an insured financial institution, and you must own the funds and any interest. Virginia also requires consumer funds to be held at an FDIC-insured institution.",
        cite: "16 CFR 310.4(a)(5)(ii)(A)–(B) · Va. Code § 6.2-2040", ask: "Ask for the bank's name and the account administrator's name, and confirm the account is in your name." },
      { id: "affiliated", bad: "yes", sev: "violation",
        q: "Is the company that administers your account owned by, controlled by, or affiliated with the settlement company?",
        title: "Account administrator tied to the settlement company",
        body: "The entity administering your dedicated account may not be owned or controlled by, or affiliated with, the debt relief company, and the two may not pay each other for referrals.",
        cite: "16 CFR 310.4(a)(5)(ii)(C)–(D) · 10VAC5-230-50", ask: "Ask whether the account administrator shares any owners with the company or pays it referral fees." },
      { id: "withdraw", bad: "no", sev: "violation",
        q: "Can you withdraw your money at any time without penalty, and get it within 7 business days?",
        title: "Your money is locked up or penalized",
        body: "You may withdraw from the dedicated account at any time without penalty. If you leave the program, you must get all funds back — minus fees already properly earned — within 7 business days of asking.",
        cite: "16 CFR 310.4(a)(5)(ii)(E)", ask: "Ask in writing how to close the account and how long the refund takes." },
    ]},
    { name: "Sales promises", qs: [
      { id: "guarantee", bad: "yes", sev: "violation",
        q: "Did the company guarantee results — a set percentage off, debt-free by a date, or an end to collection calls and lawsuits?",
        title: "Guaranteed or exaggerated results",
        body: "It's illegal to misrepresent how much you'll save, how long it will take, or the effect on collection efforts. Creditors don't have to settle, and they can still sue while you're in a program.",
        cite: "16 CFR 310.3(a)(2)(x) · Va. Code § 6.2-2042 · Va. Code § 59.1-200", ask: "Ask what share of customers actually finish the program, and get any promise in writing." },
      { id: "nonprofit", bad: "yes", sev: "flag",
        q: "Did the company say it's a nonprofit, a government program, or part of a 'new federal debt relief' plan?",
        title: "Nonprofit or government claims",
        body: "There is no government debt-forgiveness program for credit cards. Misrepresenting nonprofit status is specifically prohibited — and many for-profit companies use names that sound official.",
        cite: "16 CFR 310.3(a)(2)(x) · FTC Act § 5", ask: "Ask for its tax status (IRS Form 990 for nonprofits) and check the Virginia business registration (lookup 2)." },
      { id: "stopPaying", bad: "yes", sev: "violation",
        q: "Did they tell you to stop paying creditors without warning that it can hurt your credit, add fees and interest, and lead to lawsuits?",
        title: "Risks of not paying creditors weren't disclosed",
        body: "If a program relies on you not paying creditors, the company must tell you that it will likely hurt your credit, that you may be sent to collections or sued, and that fees and interest may increase what you owe.",
        cite: "16 CFR 310.3(a)(1)(viii)(C)", ask: "Ask the company to put these risks in writing." },
      { id: "timeline", bad: "no", sev: "violation",
        q: "Did they tell you how long it will take, when they'll make an offer to each creditor, and how much you must save first?",
        title: "Timeline and savings targets weren't disclosed",
        body: "Before you enroll, the company must disclose how long it will take to get results, when it will make a bona fide settlement offer to each creditor, and how much you must save before each offer.",
        cite: "16 CFR 310.3(a)(1)(viii)(A)–(B)", ask: "Ask for a written schedule showing when each creditor will get an offer." },
      { id: "credit", bad: "yes", sev: "flag",
        q: "Did they promise to improve or repair your credit report or score?",
        title: "Credit repair promises",
        body: "Debt settlement usually lowers credit scores. A company that promises credit improvement may also be covered by the Credit Repair Organizations Act — no payment before services are fully performed, plus a 3-business-day right to cancel.",
        cite: "15 U.S.C. 1679b(b), 1679e", ask: "Ask what they mean by 'improve your credit' and get it in writing." },
      { id: "pressure", bad: "yes", sev: "flag",
        q: "Were you pressured to sign right away, or told not to talk to your creditors or a lawyer?",
        title: "High-pressure tactics",
        body: "Legitimate providers give you time to read the agreement and compare options, including nonprofit credit counseling. Telling you not to contact creditors can leave you blind to lawsuits.",
        cite: "Va. Code § 59.1-200 (deceptive practices)", ask: "Take the contract home and read it before signing." },
    ]},
    { name: "Contract", qs: [
      { id: "written", bad: "no", sev: "violation",
        q: "Did you get a signed, dated written agreement, with a copy for you?",
        title: "No written agreement or copy",
        body: "A Virginia licensee must use a written, signed, and dated agreement containing required terms, and give you a duplicate original once both parties sign.",
        cite: "Va. Code § 6.2-2040", ask: "Request a complete signed copy of your agreement." },
      { id: "cancel", bad: "no", sev: "violation",
        q: "Does the agreement say you can cancel at any time, for any reason?",
        title: "No right to cancel at any time",
        body: "Virginia requires the agreement to state that you may end it at any time for any reason and have no obligation to continue unless you're satisfied, and to explain how disputes are resolved.",
        cite: "Va. Code § 6.2-2040", ask: "Find the cancellation clause in your contract." },
      { id: "poa", bad: "yes", sev: "violation",
        q: "Were you required to sign a power of attorney to enroll?",
        title: "Power of attorney required",
        body: "A Virginia licensee may not require you to sign a power of attorney as a condition of providing debt settlement services.",
        cite: "Va. Code § 6.2-2040", ask: "Check your enrollment documents for a power of attorney." },
      { id: "taxes", bad: "no", sev: "flag",
        q: "Did they explain that forgiven debt may be taxable income (IRS Form 1099-C)?",
        title: "Tax consequences not explained",
        body: "Forgiven debt is generally taxable unless you were insolvent. Leaving this out can make the savings look bigger than they are.",
        cite: "26 U.S.C. 61(a)(11), 108 · IRS Pub. 4681", ask: "Ask how forgiven amounts will be reported and estimate the tax in Tool 2." },
    ]},
  ];
  const QUESTIONS = GROUPS.flatMap((g) => g.qs);

  function renderQuiz() {
    const opt = (q, v, label) => {
      const cls = v === "unsure" ? "" : v === q.bad ? "is-bad" : "is-good";
      const checked = state.answers[q.id] === v ? "checked" : "";
      return `<label><input type="radio" name="${q.id}" value="${v}" ${checked}><span class="${cls}">${label}</span></label>`;
    };
    $("#quizGroups").innerHTML = GROUPS.map((g) => `
      <fieldset class="qgroup"><legend>${g.name}</legend>
        ${g.qs.map((q) => `
          <div class="q">
            <div class="q__text" id="q-${q.id}">${q.q}${q.sub ? `<small>${q.sub}</small>` : ""}</div>
            <div class="seg" role="radiogroup" aria-labelledby="q-${q.id}">
              ${opt(q, "yes", "Yes")}${opt(q, "no", "No")}${opt(q, "unsure", "Not sure")}
            </div>
          </div>`).join("")}
      </fieldset>`).join("");
    $("#quizTotal").textContent = QUESTIONS.length;
  }

  function scoreCompany() {
    const out = { violation: [], flag: [], verify: [], ok: [], answered: 0 };
    for (const q of QUESTIONS) {
      const a = state.answers[q.id];
      if (!a) continue;
      out.answered++;
      if (a === "unsure") out.verify.push({ type: "verify", title: q.q, body: q.ask, cite: q.cite, q });
      else if (a === q.bad) out[q.sev].push({ type: q.sev, title: q.title, body: q.body, cite: q.cite, q });
      else out.ok.push(q);
    }
    out.score = Math.max(0, 100 - 20 * out.violation.length - 8 * out.flag.length - 3 * out.verify.length);
    out.level = out.score < 50 || out.violation.length >= 2 ? "high" : out.violation.length || out.score < 80 ? "mid" : "low";
    return out;
  }

  function renderCompanyResult() {
    const r = scoreCompany();
    const name = companyName();
    $("#quizCount").textContent = r.answered;
    $("#resultCompany").textContent = name ? `Result for ${name}` : "Your result";
    const box = $("#companyResult");
    const fill = $("#gaugeFill");
    if (!r.answered) {
      box.removeAttribute("data-level");
      $("#gaugeScore").textContent = "—";
      fill.style.strokeDasharray = "0 100";
      $("#resultTitle").textContent = "Answer a few questions to see a result";
      $("#resultBlurb").textContent = "The score starts at 100. Each potential violation takes off more than a red flag; each \"Not sure\" takes off a little until you confirm it.";
      $("#tally").innerHTML = "";
      $("#findings").innerHTML = "";
      $("#gauge").setAttribute("aria-label", "Risk score not yet calculated");
      return r;
    }
    box.dataset.level = r.level;
    $("#gaugeScore").textContent = r.score;
    fill.style.strokeDasharray = `${r.score} 100`;
    $("#gauge").setAttribute("aria-label", `Shield score ${r.score} out of 100`);
    const head = {
      high: ["High risk", "Your answers point to serious problems. Stop sending money until you get answers, and consider reporting the company and talking with a Virginia consumer attorney."],
      mid: [r.violation.length ? "Potential violation found" : "Proceed with caution", r.violation.length ? "At least one answer matches a practice the law prohibits. Get the details in writing and consider a complaint." : "Nothing clearly illegal yet, but there are red flags or open questions to resolve before you commit."],
      low: ["Lower risk — so far", "Your answers don't match any prohibited practices. Keep checking the open items and run your numbers in the settlement checker."],
    }[r.level];
    $("#resultTitle").textContent = head[0];
    $("#resultBlurb").textContent = head[1] + (r.answered < QUESTIONS.length ? ` (${QUESTIONS.length - r.answered} questions unanswered.)` : "");
    $("#tally").innerHTML = [
      r.violation.length && `<span class="pill pill--red">${r.violation.length} potential violation${r.violation.length > 1 ? "s" : ""}</span>`,
      r.flag.length && `<span class="pill pill--amber">${r.flag.length} red flag${r.flag.length > 1 ? "s" : ""}</span>`,
      r.verify.length && `<span class="pill pill--gray">${r.verify.length} to find out</span>`,
      r.ok.length && `<span class="pill pill--green">${r.ok.length} check${r.ok.length > 1 ? "s" : ""} passed</span>`,
    ].filter(Boolean).join("");
    const section = (label, list) => list.length ? `<p class="findings__group">${label}</p>` + list.map((f) => finding(f)).join("") : "";
    $("#findings").innerHTML =
      section("Potential violations", r.violation) +
      section("Red flags", r.flag) +
      section("Find out", r.verify);
    return r;
  }

  /* =========================================================
     TOOL 2 — SETTLEMENT CHECK
     ========================================================= */
  const TIMING = [
    ["after", "After my first payment"],
    ["beforePay", "Before my first payment"],
    ["before", "Before it was settled"],
    ["unknown", "Not sure"],
  ];
  const blankDebt = () => ({ name: "", enrolled: "", atSettle: "", paid: "", fee: "", when: "after" });
  const settle = Object.assign({ basis: "enrolled", rate: "20", debts: [blankDebt()], other: "0", acct: "0", fed: "12", va: "5.75", insolvent: false }, state.settle || {});
  if (!Array.isArray(settle.debts) || !settle.debts.length) settle.debts = [blankDebt()];

  const debtRows = $("#debtRows");
  function debtRowHTML(d, i) {
    const money = (key, label, ph) => `
      <div class="field"><label for="d${i}-${key}">${label}</label>
        <div class="input-affix input-affix--pre"><span>$</span><input id="d${i}-${key}" data-k="${key}" type="number" inputmode="decimal" min="0" step="0.01" placeholder="${ph}" value="${esc(d[key])}"></div>
      </div>`;
    return `<div class="debt" data-i="${i}">
      <div class="field debt__name"><label for="d${i}-name">Creditor</label>
        <input id="d${i}-name" data-k="name" type="text" placeholder="Creditor ${i + 1}" value="${esc(d.name)}"></div>
      ${money("enrolled", "Owed when enrolled", "0")}
      ${money("atSettle", "Owed when settled (optional)", "same")}
      ${money("paid", "Settled for", "0")}
      ${money("fee", "Fee charged (optional)", "auto")}
      <div class="field debt__when"><label for="d${i}-when">When was the fee first charged?</label>
        <select id="d${i}-when" data-k="when">${TIMING.map(([v, l]) => `<option value="${v}" ${d.when === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <button type="button" class="debt__remove" data-remove="${i}" aria-label="Remove ${esc(d.name || "debt " + (i + 1))}"><span class="ico" aria-hidden="true">×</span><span class="lbl">Remove</span></button>
    </div>`;
  }
  function renderDebtRows() {
    debtRows.innerHTML = settle.debts.map(debtRowHTML).join("");
  }

  function syncSettleForm() {
    $$('input[name="feeBasis"]').forEach((r) => { r.checked = r.value === settle.basis; });
    $("#feeRate").value = settle.rate;
    $("#feeRateField").hidden = settle.basis === "unknown";
    $("#otherFees").value = settle.other;
    $("#acctFees").value = settle.acct;
    $("#fedRate").value = settle.fed;
    $("#vaRate").value = settle.va;
    $("#insolvent").checked = !!settle.insolvent;
    renderDebtRows();
  }

  function computeSettlement() {
    const rate = num(settle.rate) / 100;
    const basis = settle.basis;
    const rows = [];
    const findings = [];
    for (const [i, d] of settle.debts.entries()) {
      const E = num(d.enrolled), P = num(d.paid);
      if (!(E > 0) || !(P >= 0)) continue;
      const S = num(d.atSettle) > 0 ? num(d.atSettle) : E;
      const name = d.name.trim() || `Creditor ${i + 1}`;
      const savedTSR = E - P;            // federal: measured from balance at enrollment
      const savedVA = Math.max(S - P, 0); // Virginia 30% option: measured from balance when settled
      const capA = 0.2 * E, capB = 0.3 * savedVA;
      let fee = num(d.fee), feeAuto = false;
      if (!(fee >= 0)) {
        feeAuto = true;
        fee = basis === "enrolled" && rate >= 0 ? rate * E : basis === "savings" && rate >= 0 ? rate * Math.max(savedTSR, 0) : 0;
      }
      const cap = basis === "enrolled" ? capA : basis === "savings" ? capB : Math.max(capA, capB);
      const capLabel = basis === "enrolled" ? "20% of enrolled debt" : basis === "savings" ? "30% of amount saved" : "the higher of Virginia's two caps";
      const row = { name, E, S, P, fee, feeAuto, savedTSR, savedVA, cap, capA, capB, when: d.when, flags: [] };

      // Virginia fee cap
      if (fee > cap + 0.5) {
        row.capStatus = "bad";
        findings.push({ type: "violation", title: `${esc(name)}: fee is ${usd(fee - cap)} over Virginia's cap`,
          body: `A fee of ${usd(fee)} exceeds ${capLabel} (${usd(cap)}). Virginia allows no more than 20% of the enrolled principal (${usd(capA)} here) or 30% of the amount saved measured from the balance at settlement (${usd(capB)} here).`,
          cite: "Va. Code § 6.2-2041(A)–(B)" });
      } else row.capStatus = "ok";

      // Federal: how a per-debt fee may be computed
      if (!feeAuto && rate > 0 && basis !== "unknown") {
        const expected = basis === "enrolled" ? rate * E : rate * Math.max(savedTSR, 0);
        if (fee > expected * 1.02 + 5) {
          row.formula = "warn";
          findings.push({ type: "flag", title: `${esc(name)}: fee doesn't match your contract's formula`,
            body: basis === "enrolled"
              ? `At ${pct(rate, 1)} of this debt's enrolled balance, the fee should be about ${usd(expected)}, not ${usd(fee)}. Federal rules require each debt's fee to be proportional to its share of your total enrolled debt.`
              : `At ${pct(rate, 1)} of the amount saved, the fee should be about ${usd(expected)}, not ${usd(fee)}. Federal rules measure savings from the balance when you enrolled — not a higher balance after interest and late fees.`,
            cite: "16 CFR 310.4(a)(5)(i)(C)" });
        } else row.formula = "ok";
      }

      // Timing of the fee
      if (d.when === "before") {
        findings.push({ type: "violation", title: `${esc(name)}: fee charged before the debt was settled`,
          body: "Fees may not be requested or received until the debt is settled under an agreement you signed and you've made a payment under it.",
          cite: "16 CFR 310.4(a)(5)(i)(A)–(B) · Va. Code § 6.2-2040" });
      } else if (d.when === "beforePay") {
        findings.push({ type: "violation", title: `${esc(name)}: fee charged before your first settlement payment`,
          body: "Under the federal rule, the fee is earned only after you have made at least one payment under the settlement agreement.",
          cite: "16 CFR 310.4(a)(5)(i)(B)" });
      } else if (d.when === "unknown") {
        findings.push({ type: "verify", title: `${esc(name)}: when was the fee taken?`,
          body: "Compare your dedicated-account statement with the date of your first settlement payment. A fee taken earlier is a banned advance fee.",
          cite: "16 CFR 310.4(a)(5)(i)" });
      }
      if (S > E) row.flags.push("grew");
      if (P > E) {
        findings.push({ type: "flag", title: `${esc(name)}: settled for more than you owed at enrollment`,
          body: `You paid ${usd(P)} on a debt that was ${usd(E)} when you enrolled. Interest and fees grew faster than the settlement saved.`,
          cite: "16 CFR 310.3(a)(1)(viii)(C)" });
      }
      rows.push(row);
    }

    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    const T = { E: sum("E"), S: sum("S"), P: sum("P"), fee: sum("fee") };
    T.other = Math.max(num(settle.other) || 0, 0);
    T.acct = Math.max(num(settle.acct) || 0, 0);
    T.forgiven = rows.reduce((a, r) => a + r.savedVA, 0);
    const taxRate = ((num(settle.fed) || 0) + (num(settle.va) || 0)) / 100;
    T.tax = settle.insolvent ? 0 : T.forgiven * taxRate;
    T.cost = T.P + T.fee + T.other + T.acct + T.tax;
    T.net = T.E - T.cost;
    T.netPct = T.E ? T.net / T.E : NaN;
    T.feesAll = T.fee + T.other + T.acct;

    if (rows.length) {
      if (T.other > 0) findings.unshift({ type: "violation", title: `${usd(T.other)} in extra fees paid to the company`,
        body: "A Virginia licensee may not charge any fee for debt settlement services beyond the capped settlement fee. Federally, enrollment or monthly fees taken before debts settle are banned advance fees.",
        cite: "Va. Code § 6.2-2041(C) · 16 CFR 310.4(a)(5)(i)" });
      if (T.acct > 0) findings.push({ type: "info", title: `${usd(T.acct)} in dedicated account fees`,
        body: "These go to the bank or account administrator, not the settlement company — but they're still part of your cost. The administrator must not be owned by or affiliated with the settlement company.",
        cite: "16 CFR 310.4(a)(5)(ii)(C)" });
      const grew = rows.filter((r) => r.flags.includes("grew"));
      if (grew.length) findings.push({ type: "info", title: `Balances grew by ${usd(T.S - T.E)} while you saved`,
        body: "Interest and late fees kept accruing after you stopped paying. Real savings are measured against what you owed when you enrolled.",
        cite: "16 CFR 310.3(a)(1)(viii)(C)" });
      const big = rows.filter((r) => r.savedVA >= 600);
      if (big.length) findings.push({ type: "info", title: settle.insolvent ? "Forgiven debt: check the insolvency exclusion" : `Expect ${big.length === 1 ? "a Form 1099-C" : big.length + " Forms 1099-C"} — about ${usd(T.tax)} in tax`,
        body: settle.insolvent
          ? `You may exclude up to ${usd(T.forgiven)} of forgiven debt to the extent you were insolvent. File IRS Form 982 with your return.`
          : `${usd(T.forgiven)} was forgiven. Creditors that cancel $600 or more report it on Form 1099-C, and it's generally taxable on your federal and Virginia returns unless you were insolvent.`,
        cite: "26 U.S.C. 61(a)(11), 108, 6050P · IRS Pub. 4681" });
      if (T.net <= 0) findings.unshift({ type: "flag", title: "No real savings",
        body: `After fees${T.tax ? " and estimated taxes" : ""}, you paid ${usd(-T.net)} more than you owed when you enrolled. Paying in full, a debt management plan, or bankruptcy might have cost less.`,
        cite: "16 CFR 310.3(a)(2)(x) — savings may not be misrepresented" });
      if (!findings.some((f) => f.type === "violation" || f.type === "flag")) findings.unshift({ type: "ok", title: "Fees are within Virginia's cap and timed correctly",
        body: "Based on what you entered, each fee is within the cap and was charged after settlement and payment.", cite: "Va. Code § 6.2-2041 · 16 CFR 310.4(a)(5)(i)" });
    }
    return { rows, T, findings };
  }

  const SEGS = [
    { key: "P", label: "Paid to creditors", cls: "s1" },
    { key: "fee", label: "Settlement fees", cls: "s2" },
    { key: "other2", label: "Other & account fees", cls: "s3" },
    { key: "tax", label: "Est. taxes", cls: "s4" },
  ];

  function renderSettlement() {
    const { rows, T, findings } = computeSettlement();
    const kpis = $("#kpis"), stack = $("#stack"), legend = $("#legend");
    if (!rows.length) {
      kpis.innerHTML = "";
      stack.className = "stack";
      stack.innerHTML = '<div class="stack__empty">Enter at least one debt with an enrolled balance and a settled amount.</div>';
      stack.setAttribute("aria-label", "No data yet");
      legend.innerHTML = "";
      $("#breakdownSub").textContent = "";
      $("#settleFindings").innerHTML = '<p class="muted">Checks appear once you enter a debt.</p>';
      $("#detailTable").innerHTML = "";
      return { rows, T, findings };
    }

    const netCls = T.net <= 0 ? "bad" : T.netPct < 0.15 ? "warn" : "good";
    kpis.innerHTML = `
      <div class="kpi"><div class="kpi__label">Owed when enrolled</div><div class="kpi__value">${usd(T.E)}</div><div class="kpi__sub">${rows.length} debt${rows.length > 1 ? "s" : ""}${T.S > T.E ? ` · grew to ${usd(T.S)}` : ""}</div></div>
      <div class="kpi"><div class="kpi__label">Settled for</div><div class="kpi__value">${usd(T.P)}</div><div class="kpi__sub">${pct(T.P / T.E)} of the enrolled balance</div></div>
      <div class="kpi"><div class="kpi__label">All fees</div><div class="kpi__value">${usd(T.feesAll)}</div><div class="kpi__sub">${pct(T.feesAll / T.E, 1)} of enrolled debt · VA cap ${usd(T.E * 0.2)} at 20%</div></div>
      <div class="kpi kpi--hero kpi--${netCls}"><div class="kpi__label">Real savings</div><div class="kpi__value">${usd(T.net)}</div><div class="kpi__sub">${pct(T.netPct)} of what you owed, after fees${T.tax ? " &amp; est. taxes" : ""}</div></div>`;

    // Stacked bar: where the original debt went
    const vals = { P: T.P, fee: T.fee, other2: T.other + T.acct, tax: T.tax };
    const scale = Math.max(T.E, T.cost);
    let html = SEGS.filter((s) => vals[s.key] > 0).map((s) =>
      `<div class="stack__seg stack__seg--${s.cls}" style="flex:${vals[s.key] / scale} 0 0" data-tip="${esc(s.label)}|${vals[s.key]}"></div>`).join("");
    if (T.net > 0) html += `<div class="stack__seg stack__seg--save" style="flex:${T.net / scale} 0 0" data-tip="Real savings|${T.net}"></div>`;
    else html += `<div class="stack__mark" style="left:${(T.E / scale) * 100}%"><span>Original debt</span></div>`;
    stack.className = "stack" + (T.net > 0 ? "" : " stack--over");
    stack.innerHTML = html;
    stack.setAttribute("aria-label", `Of ${usd(T.E)} owed at enrollment: ${usd(T.P)} paid to creditors, ${usd(T.fee)} settlement fees, ${usd(T.other + T.acct)} other fees, ${usd(T.tax)} estimated taxes, ${T.net > 0 ? usd(T.net) + " real savings" : usd(-T.net) + " more than the original debt"}.`);
    $("#breakdownSub").textContent = T.net > 0 ? `Bar = ${usd(T.E)} owed at enrollment` : `Total cost ${usd(T.cost)} vs. ${usd(T.E)} owed`;
    const swatch = (cls) => cls === "save" ? '<i style="box-shadow:inset 0 0 0 1.5px var(--hatch);background:repeating-linear-gradient(45deg,transparent 0 3px,var(--hatch) 3px 4px)"></i>' : `<i style="background:var(--${cls})"></i>`;
    legend.innerHTML = SEGS.filter((s) => vals[s.key] > 0).map((s) => `<li>${swatch(s.cls)}${s.label} <b>${usd(vals[s.key])}</b></li>`).join("")
      + (T.net > 0 ? `<li>${swatch("save")}Real savings <b>${usd(T.net)}</b></li>` : "");

    const order = { violation: 0, flag: 1, verify: 2, info: 3, ok: 4 };
    $("#settleFindings").innerHTML = findings.slice().sort((a, b) => order[a.type] - order[b.type]).map((f) => finding(f, "h5")).join("");

    const st = (cls, text) => `<span class="status status--${cls}">${text}</span>`;
    const whenTxt = { after: st("ok", "After payment"), beforePay: st("bad", "Before payment"), before: st("bad", "Before settlement"), unknown: st("na", "Not sure") };
    $("#detailTable").innerHTML = `
      <thead><tr><th scope="col">Creditor</th><th scope="col">Enrolled</th><th scope="col">At settlement</th><th scope="col">Settled for</th><th scope="col">% of enrolled</th><th scope="col">Fee</th><th scope="col">VA cap</th><th scope="col">Cap check</th><th scope="col">Fee timing</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.name)}</td><td>${usd(r.E, true)}</td><td>${usd(r.S, true)}</td><td>${usd(r.P, true)}</td>
        <td>${pct(r.P / r.E, 1)}</td><td>${usd(r.fee, true)}${r.feeAuto ? ' <small class="muted">(est.)</small>' : ""}</td><td>${usd(r.cap, true)}</td>
        <td>${r.capStatus === "bad" ? st("bad", "Over cap") : st("ok", "Within")}</td><td>${whenTxt[r.when] || ""}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td>${usd(T.E, true)}</td><td>${usd(T.S, true)}</td><td>${usd(T.P, true)}</td><td>${pct(T.P / T.E, 1)}</td><td>${usd(T.fee, true)}</td><td>${usd(rows.reduce((a, r) => a + r.cap, 0), true)}</td><td></td><td></td></tr></tfoot>`;
    return { rows, T, findings };
  }

  // tooltip on the stacked bar
  const tip = $("#tip"), fig = $(".breakdown");
  $("#stack").addEventListener("mousemove", (e) => {
    const seg = e.target.closest("[data-tip]");
    if (!seg) { tip.hidden = true; return; }
    const [label, v] = seg.dataset.tip.split("|");
    const { T } = computeSettlement();
    tip.innerHTML = `${esc(label)}<br><b>${usd(+v, true)}</b> · ${pct(+v / T.E, 1)} of original debt`;
    tip.hidden = false;
    const box = fig.getBoundingClientRect();
    let x = e.clientX - box.left + 14;
    x = Math.min(x, box.width - tip.offsetWidth - 8);
    tip.style.left = x + "px";
    tip.style.top = (e.clientY - box.top - tip.offsetHeight - 12) + "px";
  });
  $("#stack").addEventListener("mouseleave", () => { tip.hidden = true; });

  /* =========================================================
     COMPLAINT BUILDER
     ========================================================= */
  const complaintBox = $("#complaint");
  let complaintEdited = false;
  const plain = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  function buildComplaint() {
    const r = scoreCompany();
    const s = computeSettlement();
    const name = companyName() || "[company name]";
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const L = [];
    L.push(`Complaint regarding: ${name}`, `Date: ${date}`, "");
    L.push(`I am a Virginia resident who enrolled in a debt settlement program with ${name}. Based on my experience, I believe the company may have violated Virginia and/or federal law, as described below.`, "");
    const violations = [...r.violation, ...s.findings.filter((f) => f.type === "violation")];
    if (violations.length) {
      L.push("POSSIBLE VIOLATIONS");
      violations.forEach((f, i) => L.push(`${i + 1}. ${plain(f.title)} (${plain(f.cite)})`));
      L.push("");
    }
    const flags = [...r.flag, ...s.findings.filter((f) => f.type === "flag")];
    if (flags.length) {
      L.push("OTHER CONCERNS");
      flags.forEach((f) => L.push(`- ${plain(f.title)}`));
      L.push("");
    }
    if (s.rows.length) {
      const T = s.T;
      L.push("SETTLEMENT FIGURES");
      L.push(`- Debt enrolled: ${usd(T.E, true)} across ${s.rows.length} account${s.rows.length > 1 ? "s" : ""}`);
      L.push(`- Amount paid to creditors: ${usd(T.P, true)} (${pct(T.P / T.E, 1)} of enrolled balance)`);
      L.push(`- Settlement fees charged: ${usd(T.fee, true)}${T.other ? `; other fees paid to the company: ${usd(T.other, true)}` : ""}`);
      L.push(`- Virginia fee cap at 20% of enrolled debt: ${usd(T.E * 0.2, true)}`);
      s.rows.forEach((row) => L.push(`  • ${row.name}: enrolled ${usd(row.E, true)}, settled for ${usd(row.P, true)}, fee ${usd(row.fee, true)}`));
      L.push("");
    }
    L.push("WHAT HAPPENED");
    L.push("[In your own words: when you enrolled, who you spoke with, what you were promised, what fees were taken and when, and what happened with your creditors. Attach your contract and account statements.]", "");
    L.push("WHAT I AM ASKING FOR");
    L.push("[For example: a refund of improperly charged fees, release of the funds in my dedicated account, cancellation of my agreement, and an investigation of the company's practices.]");
    return L.join("\n");
  }
  function refreshComplaint(force = false) {
    if (force || !complaintEdited) { complaintBox.value = buildComplaint(); if (force) complaintEdited = false; }
  }
  complaintBox.addEventListener("input", () => { complaintEdited = true; });
  $("#regenComplaint").addEventListener("click", () => refreshComplaint(true));
  $("#copyComplaint").addEventListener("click", async () => {
    const msg = $("#copied");
    try {
      await navigator.clipboard.writeText(complaintBox.value);
      msg.textContent = "Copied.";
    } catch {
      complaintBox.select();
      msg.textContent = document.execCommand && document.execCommand("copy") ? "Copied." : "Select the text and copy it.";
    }
    setTimeout(() => { msg.textContent = ""; }, 2500);
  });

  /* =========================================================
     WIRING
     ========================================================= */
  function updateAll() {
    renderCompanyResult();
    renderSettlement();
    refreshComplaint();
  }

  nameInput.addEventListener("input", () => {
    state.company = nameInput.value;
    persist();
    renderLookups();
    renderCompanyResult();
    refreshComplaint();
  });

  $("#quiz").addEventListener("change", (e) => {
    if (e.target.type !== "radio") return;
    state.answers[e.target.name] = e.target.value;
    persist();
    renderCompanyResult();
    refreshComplaint();
  });
  $("#quiz").addEventListener("submit", (e) => e.preventDefault());
  $("#quizReset").addEventListener("click", () => {
    state.answers = {};
    persist();
    renderQuiz();
    renderCompanyResult();
    refreshComplaint();
  });

  const saveSettle = () => { state.settle = settle; persist(); };
  const settleForm = $("#settleForm");
  settleForm.addEventListener("submit", (e) => e.preventDefault());
  settleForm.addEventListener("input", (e) => {
    const t = e.target;
    const row = t.closest(".debt");
    if (row && t.dataset.k) settle.debts[+row.dataset.i][t.dataset.k] = t.value;
    else if (t.name === "feeBasis") { settle.basis = t.value; $("#feeRateField").hidden = t.value === "unknown"; }
    else if (t.id === "feeRate") settle.rate = t.value;
    else if (t.id === "otherFees") settle.other = t.value;
    else if (t.id === "acctFees") settle.acct = t.value;
    else if (t.id === "fedRate") settle.fed = t.value;
    else if (t.id === "vaRate") settle.va = t.value;
    else if (t.id === "insolvent") settle.insolvent = t.checked;
    saveSettle();
    renderSettlement();
    refreshComplaint();
  });
  debtRows.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    settle.debts.splice(+btn.dataset.remove, 1);
    if (!settle.debts.length) settle.debts.push(blankDebt());
    saveSettle();
    renderDebtRows();
    renderSettlement();
    refreshComplaint();
  });
  $("#addDebt").addEventListener("click", () => {
    settle.debts.push(blankDebt());
    saveSettle();
    renderDebtRows();
    $(`#d${settle.debts.length - 1}-name`).focus();
  });
  $("#loadExample").addEventListener("click", () => {
    Object.assign(settle, {
      basis: "enrolled", rate: "25", other: "0", acct: "540", fed: "12", va: "5.75", insolvent: false,
      debts: [
        { name: "Card A", enrolled: "8200", atSettle: "9450", paid: "4100", fee: "", when: "after" },
        { name: "Card B", enrolled: "5600", atSettle: "6300", paid: "2950", fee: "1400", when: "beforePay" },
        { name: "Store card", enrolled: "2300", atSettle: "2650", paid: "1150", fee: "", when: "after" },
      ],
    });
    saveSettle();
    syncSettleForm();
    renderSettlement();
    refreshComplaint();
  });

  $$("[data-print]").forEach((b) => b.addEventListener("click", () => {
    document.body.classList.toggle("print-settle", b.dataset.print === "settle");
    window.print();
  }));
  window.addEventListener("afterprint", () => document.body.classList.remove("print-settle"));

  /* ---------- init ---------- */
  renderLookups();
  renderQuiz();
  syncSettleForm();
  updateAll();
})();
