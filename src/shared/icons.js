/* Compass Toolkit — inline SVG icons.
 *
 * Line icons on a 24×24 grid, drawn with `currentColor` so they take the
 * colour of whatever they sit in — white on the in-page buttons, the text
 * colour in the popup. Shared by the popup, the content scripts and the
 * printable pages so one icon means the same thing everywhere.
 */

var CompassToolkitIcons = (function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";

  // Each icon is a list of [tag, attributes] shapes.
  const ICONS = {
    printer: [
      ["polyline", { points: "6 9 6 2 18 2 18 9" }],
      [
        "path",
        {
          d: "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
        }
      ],
      ["rect", { x: "6", y: "14", width: "12", height: "8", rx: "1" }]
    ],
    clipboard: [
      [
        "path",
        {
          d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
        }
      ],
      ["rect", { x: "8", y: "2", width: "8", height: "4", rx: "1" }],
      ["polyline", { points: "9 14 11 16 15 12" }]
    ],
    calendar: [
      ["rect", { x: "3", y: "4", width: "18", height: "18", rx: "2" }],
      ["line", { x1: "16", y1: "2", x2: "16", y2: "6" }],
      ["line", { x1: "8", y1: "2", x2: "8", y2: "6" }],
      ["line", { x1: "3", y1: "10", x2: "21", y2: "10" }]
    ],
    filter: [
      ["polygon", { points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" }]
    ],
    link: [
      ["path", { d: "M15 7h3a5 5 0 0 1 0 10h-3" }],
      ["path", { d: "M9 17H6A5 5 0 0 1 6 7h3" }],
      ["line", { x1: "8", y1: "12", x2: "16", y2: "12" }]
    ],
    checkSquare: [
      ["polyline", { points: "9 11 12 14 22 4" }],
      [
        "path",
        { d: "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" }
      ]
    ],
    download: [
      ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
      ["polyline", { points: "7 10 12 15 17 10" }],
      ["line", { x1: "12", y1: "15", x2: "12", y2: "3" }]
    ],
    check: [["polyline", { points: "20 6 9 17 4 12" }]],
    alert: [
      [
        "path",
        {
          d: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        }
      ],
      ["line", { x1: "12", y1: "9", x2: "12", y2: "13" }],
      ["line", { x1: "12", y1: "17", x2: "12.01", y2: "17" }]
    ],
    close: [
      ["line", { x1: "18", y1: "6", x2: "6", y2: "18" }],
      ["line", { x1: "6", y1: "6", x2: "18", y2: "18" }]
    ],
    messageOff: [
      [
        "path",
        {
          d: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        }
      ],
      ["line", { x1: "2", y1: "2", x2: "22", y2: "22" }]
    ],
    note: [
      ["path", { d: "M12 20h9" }],
      [
        "path",
        { d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" }
      ]
    ],
    external: [
      [
        "path",
        { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }
      ],
      ["polyline", { points: "15 3 21 3 21 9" }],
      ["line", { x1: "10", y1: "14", x2: "21", y2: "3" }]
    ],
    chevronRight: [["polyline", { points: "9 18 15 12 9 6" }]],
    mapPin: [
      ["path", { d: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" }],
      ["circle", { cx: "12", cy: "10", r: "3" }]
    ],
    hourglass: [
      ["path", { d: "M6 2h12" }],
      ["path", { d: "M6 22h12" }],
      ["path", { d: "M6 2c0 4.5 6 6.5 6 10S6 17.5 6 22" }],
      ["path", { d: "M18 2c0 4.5-6 6.5-6 10s6 5.5 6 10" }]
    ],
    fileText: [
      [
        "path",
        { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }
      ],
      ["polyline", { points: "14 2 14 8 20 8" }],
      ["line", { x1: "16", y1: "13", x2: "8", y2: "13" }],
      ["line", { x1: "16", y1: "17", x2: "8", y2: "17" }]
    ],
    plus: [
      ["line", { x1: "12", y1: "5", x2: "12", y2: "19" }],
      ["line", { x1: "5", y1: "12", x2: "19", y2: "12" }]
    ],
    trash: [
      ["polyline", { points: "3 6 5 6 21 6" }],
      [
        "path",
        {
          d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        }
      ],
      ["line", { x1: "10", y1: "11", x2: "10", y2: "17" }],
      ["line", { x1: "14", y1: "11", x2: "14", y2: "17" }]
    ],
    chevronDown: [["polyline", { points: "6 9 12 15 18 9" }]]
  };

  const BASE_ATTRS = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false"
  };

  function has(name) {
    return Object.prototype.hasOwnProperty.call(ICONS, name);
  }

  /* Build an <svg> element. Preferred over markup() — no HTML parsing, and
   * safe to use where innerHTML would be awkward. */
  function create(name, size) {
    const svg = document.createElementNS(NS, "svg");
    Object.keys(BASE_ATTRS).forEach(function (attr) {
      svg.setAttribute(attr, BASE_ATTRS[attr]);
    });
    const px = (size || 16) + "px";
    svg.setAttribute("width", size || 16);
    svg.setAttribute("height", size || 16);
    // Inline sizing so page styles on the Compass side can't stretch it.
    svg.style.width = px;
    svg.style.height = px;
    svg.style.flexShrink = "0";

    (ICONS[name] || []).forEach(function (shape) {
      const node = document.createElementNS(NS, shape[0]);
      Object.keys(shape[1]).forEach(function (attr) {
        node.setAttribute(attr, shape[1][attr]);
      });
      svg.appendChild(node);
    });
    return svg;
  }

  /* Same icon as a string, for the pages that build HTML from templates. */
  function markup(name, size) {
    const px = size || 16;
    const attrs = Object.keys(BASE_ATTRS)
      .map(function (attr) {
        return attr + '="' + BASE_ATTRS[attr] + '"';
      })
      .join(" ");
    const shapes = (ICONS[name] || [])
      .map(function (shape) {
        const inner = Object.keys(shape[1])
          .map(function (attr) {
            return attr + '="' + shape[1][attr] + '"';
          })
          .join(" ");
        return "<" + shape[0] + " " + inner + " />";
      })
      .join("");
    return (
      '<svg width="' + px + '" height="' + px + '" ' + attrs + ">" + shapes + "</svg>"
    );
  }

  return { create: create, markup: markup, has: has, NAMES: Object.keys(ICONS) };
})();
