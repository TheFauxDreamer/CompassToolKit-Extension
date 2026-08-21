/* Compass Toolkit: printable staff cards.
 *
 * Every sheet is laid out to be exactly one page of printable area, and every
 * card on it is the same fixed size. How many fit is worked out from the paper
 * rather than left to the browser to fragment, because a card broken across a
 * page break is the one thing this must never produce.
 */
(function () {
  "use strict";

  const KEYS = CompassToolkit.DATA_KEYS;

  const PAPER = {
    a4: { w: 210, h: 297 },
    a3: { w: 297, h: 420 }
  };
  const MARGIN = 10; // mm, matched by the @page rule below
  const GAP = 4; // mm between cards
  // A hair off the printable height. Rounding a sheet to the exact page height
  // is what tips an empty second page out of some printers.
  const SLACK = 1;

  const MAX_FIELDS = 4; // the most detail lines any card will show
  // How tall a portrait photo should be next to its width. Compass head shots
  // are portrait, so the frame is too.
  const PORTRAIT = 1.35;
  // Stretching cards to fill the sheet is good until it turns a head shot into
  // a sliver. Past this the card keeps its own height and the leftover paper
  // stays leftover.
  const PORTRAIT_MAX = 1.7;
  const BESIDE_W = 0.75; // a photo beside the text is this much of its height
  const PAD = 1.6; // mm of padding inside a card, matching the stylesheet
  // The card's 1px border, in mm. box-sizing is border-box, so the space left
  // for content is the card's height less its padding AND its border. Leaving
  // the border out is two pixels of overflow, which is exactly enough to shave
  // the last line off a card.
  const BORDER = 0.27;
  const INSET = (PAD + BORDER) * 2;
  const WHO_TOP = 1.2; // margin above the name
  const MAIL_TOP = 0.8; // padding above the email

  let cards = [];
  let withPhotos = true;
  // How many detail lines to leave room for, taken from the cards themselves
  // rather than assumed. Reserving four when nobody has more than two is half
  // the wasted space on a card.
  let fieldRows = MAX_FIELDS;
  // Added to every card after measuring what the text actually needed. Fonts
  // render differently from the arithmetic that sizes them, and a card whose
  // last line is shaved off is the whole thing this has to avoid.
  let extraHeight = 0;
  let passes = 0;
  const MAX_PASSES = 4;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /* ---------------- geometry ---------------- */

  function layout() {
    const [size, orientation] = document.getElementById("paper").value.split("-");
    const cols = parseInt(document.getElementById("cols").value, 10);
    const photos = withPhotos && document.getElementById("photos").value === "yes";
    const beside = document.getElementById("shape").value === "beside";

    const paper = PAPER[size] || PAPER.a4;
    const pageW = orientation === "landscape" ? paper.h : paper.w;
    const pageH = orientation === "landscape" ? paper.w : paper.h;

    const contentW = pageW - MARGIN * 2;
    const contentH = pageH - MARGIN * 2 - SLACK;

    const cardW = (contentW - GAP * (cols - 1)) / cols;

    /* Font sizes scale with the card, so the text block is measured in those
     * same terms: the gap above the name, the name, one line per detail the
     * cards actually carry, and the email. extraHeight is whatever measuring
     * the drawn text showed was still missing. */
    const textW = beside ? cardW * (1 - 0.28) : cardW;
    const base = Math.max(1.9, Math.min(3.1, textW / 15));
    const nameH = base * 1.15 * 1.2;
    const rowsH = base * 1.3 * fieldRows;
    const mailH = base * 0.85 * 1.3;
    const textH =
      (beside ? 0 : WHO_TOP) + nameH + rowsH + MAIL_TOP + mailH + extraHeight;

    /* The smallest a card can be and still hold its text and a photo worth
     * printing. This decides how many rows fit; it is not the size they end
     * up. */
    const minPhotoH = !photos ? 0 : beside ? textH : cardW * PORTRAIT;
    const minCardH = INSET + (beside ? Math.max(minPhotoH, textH) : minPhotoH + textH);

    const rows = Math.max(1, Math.floor((contentH + GAP) / (minCardH + GAP)));

    /* Cards are then stretched to fill the sheet. Sizing them to their contents
     * and stopping there leaves a band of empty paper at the foot of every
     * page; giving the leftover to the cards puts it into the photos. The cap
     * stops that going too far when only a row or two fits. */
    const maxCardH = !photos
      ? minCardH
      : INSET +
        (beside ? textH * 1.5 : cardW * PORTRAIT_MAX + textH);
    const cardH = Math.min((contentH - GAP * (rows - 1)) / rows, maxCardH);

    const photoH = !photos ? 0 : beside ? cardH - INSET : cardH - INSET - textH;
    const photoW = beside ? photoH * BESIDE_W : cardW;

    return {
      size, orientation, cols, rows, photos, beside,
      pageW, pageH, contentW, contentH, cardW, cardH, photoH, photoW,
      perPage: cols * rows,
      base: base
    };
  }

  /* ---------------- rendering ---------------- */

  function render() {
    const g = layout();
    const sheets = document.getElementById("sheets");
    sheets.innerHTML = "";

    // The page box has to match the paper the sheets were measured against.
    let style = document.getElementById("pageRule");
    if (!style) {
      style = document.createElement("style");
      style.id = "pageRule";
      document.head.appendChild(style);
    }
    style.textContent =
      "@page { size: " + g.size.toUpperCase() + " " + g.orientation +
      "; margin: " + MARGIN + "mm; }";

    for (let i = 0; i < cards.length; i += g.perPage) {
      sheets.appendChild(buildSheet(cards.slice(i, i + g.perPage), g));
    }

    document.getElementById("count").textContent =
      cards.length + " cards, " + Math.ceil(cards.length / g.perPage) +
      " page" + (Math.ceil(cards.length / g.perPage) === 1 ? "" : "s") +
      " (" + g.cols + " by " + g.rows + ")";

    if (passes < MAX_PASSES) requestAnimationFrame(correctHeight);
  }

  /* How many millimetres a millimetre is on this screen, so a shortfall
   * measured in pixels can be added back in the units everything else uses. */
  function pxPerMm() {
    const ruler = document.createElement("div");
    ruler.style.cssText =
      "position:absolute;visibility:hidden;height:100mm;top:-500mm;";
    document.body.appendChild(ruler);
    const px = ruler.getBoundingClientRect().height / 100;
    ruler.remove();
    return px || 3.78;
  }

  function correctHeight() {
    let short = 0;
    document.querySelectorAll(".card").forEach(function (card) {
      short = Math.max(short, card.scrollHeight - card.clientHeight);
      // The text column clips on its own in the side-by-side layout, without
      // the card around it ever overflowing.
      const who = card.querySelector(".who");
      if (who) short = Math.max(short, who.scrollHeight - who.clientHeight);
    });
    if (short <= 1) {
      passes = MAX_PASSES; // settled
      return;
    }

    passes++;
    extraHeight += short / pxPerMm() + 0.4;
    render();
  }

  function buildSheet(group, g) {
    const sheet = el("div", "sheet");
    sheet.style.width = g.contentW + "mm";
    sheet.style.height = g.contentH + "mm";
    sheet.style.gridTemplateColumns = "repeat(" + g.cols + ", " + g.cardW + "mm)";
    sheet.style.gridAutoRows = g.cardH + "mm";
    sheet.style.gap = GAP + "mm";
    sheet.style.fontSize = g.base + "mm";

    group.forEach(function (person) {
      sheet.appendChild(buildCard(person, g));
    });
    return sheet;
  }

  function buildCard(person, g) {
    const card = el("div", "card " + (g.beside ? "beside" : "above"));
    card.style.height = g.cardH + "mm";

    if (person.status) {
      const chip = el("span", "chip", person.status);
      if (!/^active$/i.test(person.status)) chip.className = "chip other";
      chip.style.fontSize = g.base * 0.72 + "mm";
      card.appendChild(chip);
    }

    if (g.photos) {
      const frame = person.photo ? el("img", "photo") : el("div", "photo empty", "–");
      if (person.photo) {
        frame.src = person.photo;
        frame.alt = "";
      }
      frame.style.height = g.photoH + "mm";
      if (g.beside) frame.style.width = g.photoW + "mm";
      card.appendChild(frame);
    }

    const who = el("div", "who");
    const name = el("div", "name", person.name || "Unnamed");
    name.style.fontSize = g.base * 1.15 + "mm";
    who.appendChild(name);

    (person.fields || []).slice(0, MAX_FIELDS).forEach(function (field) {
      const row = el("div", "row");
      row.appendChild(el("span", "k", field.label + ":"));
      row.appendChild(el("span", "v", field.value));
      who.appendChild(row);
    });

    if (person.email) {
      const mail = el("div", "email", person.email);
      mail.style.fontSize = g.base * 0.85 + "mm";
      who.appendChild(mail);
    }

    card.appendChild(who);
    return card;
  }

  /* ---------------- boot ---------------- */

  function note(message) {
    const box = document.getElementById("note");
    box.hidden = false;
    box.textContent = message;
  }

  document.getElementById("printBtn").addEventListener("click", function () {
    window.print();
  });
  document.getElementById("closeBtn").addEventListener("click", function () {
    window.close();
  });
  ["paper", "cols", "photos", "shape"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", function () {
      extraHeight = 0; // different card width, different text size
      passes = 0;
      render();
    });
  });
  document.getElementById("bw").addEventListener("change", function (e) {
    document.body.classList.toggle("bw", e.target.value === "bw");
  });

  CompassToolkit.getData([KEYS.staff]).then(function (data) {
    const stored = data[KEYS.staff];
    if (!stored || !Array.isArray(stored.cards) || !stored.cards.length) {
      note(
        "No staff cards stored yet. Open the Compass staff directory and use " +
        "Print Staff Cards."
      );
      document.getElementById("count").textContent = "";
      return;
    }
    cards = stored.cards;
    withPhotos = stored.withPhotos !== false;
    fieldRows = 1;
    cards.forEach(function (person) {
      const count = Math.min((person.fields || []).length, MAX_FIELDS);
      if (count > fieldRows) fieldRows = count;
    });
    if (!withPhotos) {
      const photos = document.getElementById("photos");
      photos.value = "no";
      photos.disabled = true;
    }
    render();
  });
})();
