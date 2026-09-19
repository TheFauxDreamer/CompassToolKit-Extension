import { DAY_NAMES, weekday, parseDate, ymdString, normalizeRepeat } from './lib.js';
import { $ } from './compass-api.js';

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

// Builds the Mon–Sun day toggles for a repeat fieldset whose ids start with `pre`.
export function buildRepeatControls(pre, onChange) {
  const box = $(`${pre}Days`);
  for (const d of MONDAY_FIRST) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = d;
    input.setAttribute('aria-label', DAY_NAMES[d]);
    input.addEventListener('change', () => { box.dataset.touched = '1'; onChange(); });
    const span = document.createElement('span');
    span.textContent = DAY_NAMES[d];
    label.append(input, span);
    box.append(label);
  }
  $(`${pre}Every`).addEventListener('input', () => {
    $(`${pre}EveryUnit`).textContent = Number($(`${pre}Every`).value) === 1 ? 'week' : 'weeks';
    onChange();
  });
  $(`${pre}Until`).addEventListener('input', onChange);
  $(`${pre}TeachingOnly`).addEventListener('change', onChange);
}

export function setRepeatDays(pre, days) {
  for (const input of $(`${pre}Days`).querySelectorAll('input')) input.checked = days.includes(Number(input.value));
}

// When the start date changes, pick its weekday unless the user has already chosen days.
export function followStartDate(pre, dateValue) {
  const date = parseDate(dateValue);
  if (!date || $(`${pre}Days`).dataset.touched) return;
  setRepeatDays(pre, [weekday(date)]);
}

export function fillRepeat(pre, repeat) {
  $(`${pre}Every`).value = repeat.every;
  $(`${pre}EveryUnit`).textContent = repeat.every === 1 ? 'week' : 'weeks';
  $(`${pre}Until`).value = ymdString(repeat.until);
  $(`${pre}TeachingOnly`).checked = repeat.teachingDaysOnly;
  setRepeatDays(pre, repeat.days);
  $(`${pre}Days`).dataset.touched = '1';
}

export function resetRepeat(pre) {
  $(`${pre}Every`).value = 1;
  $(`${pre}EveryUnit`).textContent = 'week';
  $(`${pre}Until`).value = '';
  $(`${pre}TeachingOnly`).checked = false;
  setRepeatDays(pre, []);
  delete $(`${pre}Days`).dataset.touched;
}

export function readRepeat(pre, item) {
  const days = [...$(`${pre}Days`).querySelectorAll('input:checked')].map((i) => Number(i.value));
  return normalizeRepeat({
    every: $(`${pre}Every`).value, days, until: $(`${pre}Until`).value, teachingDaysOnly: $(`${pre}TeachingOnly`).checked,
  }, item);
}
