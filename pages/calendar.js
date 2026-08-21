let allEvents = [];
let allTerms = [];
let currentView = 'term';
let enabledLayers = new Set();
let eventLayers = new Map(); // Map of color to layer info
let hideWeekends = false;
let hideDrafts = false;

/* An event Compass has not finalised yet. Schools mark these by putting
 * (Draft) in the name, anywhere in it, and the casing is not consistent.
 * Declared up here because it is read from functions that run well before the
 * bottom of this file would have been reached. */
const DRAFT = /\(\s*draft\s*\)/i;

function isDraft(event) {
  return DRAFT.test(event.title || '');
}
let paperSize = 'a4';
let fillPage = true; // Stretch weeks to the bottom of the printed page
let eventFontSize = 9; // Default font size in pixels

// Each week row is sized to its busiest day. This is the floor, so a week with
// one or no events still reads as a row rather than a sliver. Raise it if the
// printed grid looks too cramped; lower it to 1 to squeeze harder.
const MIN_WEEK_ROWS = 2;

// Read whatever the last capture stored. Kept in the same shape the page used
// when this data came back from the service worker.
function loadCapturedData(callback) {
  const KEYS = CompassToolkit.DATA_KEYS;
  CompassToolkit.getData([KEYS.calendar, KEYS.terms, KEYS.layers]).then((data) => {
    callback({
      calendar: data[KEYS.calendar] || null,
      terms: data[KEYS.terms] || null,
      layers: data[KEYS.layers] || null
    });
  });
}

// Load calendar and term data
loadCapturedData((data) => {
  console.log('[CALENDAR.JS] ========== Loading Data ==========');
  console.log('[CALENDAR.JS] Received data from background:', {
    hasCalendar: !!(data && data.calendar && data.calendar.events),
    hasTerms: !!(data && data.terms && data.terms.terms),
    hasLayers: !!(data && data.layers && data.layers.layers),
    calendarEvents: data?.calendar?.events?.length || 0,
    terms: data?.terms?.terms?.length || 0,
    layers: data?.layers?.layers?.length || 0
  });
  
  if (data && data.layers && data.layers.layers) {
    console.log('[CALENDAR.JS] Layer data details:');
    data.layers.layers.forEach((layer, i) => {
      console.log(`  ${i + 1}. "${layer.name}" (${layer.color})`);
    });
  } else {
    // The sidebar list may have been collapsed when the user captured; the
    // calendar still renders, just with colour swatches instead of names.
    console.log('[CALENDAR.JS] No layer names in this capture');
  }
  
  if (data && data.calendar && data.calendar.events) {
    allEvents = data.calendar.events.map(event => ({
      ...event,
      startDate: new Date(event.start),
      endDate: new Date(event.finish)
    })).sort((a, b) => a.startDate - b.startDate);
    
    console.log('[CALENDAR.JS] Loaded', allEvents.length, 'events');
    
    // Parse term data
    if (data.terms && data.terms.terms) {
      allTerms = data.terms.terms.map(term => ({
        ...term,
        startDate: parseAUDate(term.s),
        endDate: parseAUDate(term.f),
        name: term.n,
        year: term.cy,
        id: term.id
      })).sort((a, b) => a.startDate - b.startDate);
      console.log('[CALENDAR.JS] Loaded', allTerms.length, 'terms');
    }
    
    console.log('[CALENDAR.JS] Identifying layers by color...');
    identifyLayers();
    
    // Update layer names if we have HTML data
    if (data.layers && data.layers.layers) {
      console.log('[CALENDAR.JS] Layer data available - updating layer names...');
      updateLayerNames(data.layers);
    } else {
      console.log('[CALENDAR.JS] No layer names available - using event counts as labels');
    }
    
    populateTermFilter();
    setupEventListeners();
    updatePaperSize();
    updateFillPage(); // Match the checkbox's default (on)
    updateFontSize(); // Initialize font size
    renderCalendar();
    console.log('[CALENDAR.JS] ========== Initialization Complete ==========');
  } else {
    document.getElementById('calendarContent').innerHTML = 
      '<p style="color: #999; text-align: center;">No calendar data available. Please visit your calendar page first.</p>';
  }
});

// Update paper size class on body
function updatePaperSize() {
  document.body.classList.remove('print-a4', 'print-a3');
  document.body.classList.add(`print-${paperSize}`);
}

// Toggle the print-time page-fill behaviour (screen layout is unaffected)
function updateFillPage() {
  document.body.classList.toggle('fill-page', fillPage);
}

// Update event font size
function updateFontSize() {
  // Update CSS custom property for font size
  document.documentElement.style.setProperty('--event-font-size', `${eventFontSize}px`);
  document.documentElement.style.setProperty('--event-time-font-size', `${eventFontSize - 1}px`);
  
  // Update the display
  document.getElementById('fontSizeValue').textContent = eventFontSize;
}

// Setup event listeners
function setupEventListeners() {
  // Print button
  document.getElementById('printButton').addEventListener('click', () => {
    window.print();
  });

  // View mode change
  document.getElementById('viewMode').addEventListener('change', (e) => {
    currentView = e.target.value;
    renderCalendar();
  });

  // Term filter change
  document.getElementById('termFilter').addEventListener('change', () => {
    renderCalendar();
  });

  // Hide weekends toggle
  document.getElementById('hideWeekendsToggle').addEventListener('change', (e) => {
    hideWeekends = e.target.checked;
    renderCalendar();
  });

  // Fill page toggle
  document.getElementById('hideDraftsToggle').addEventListener('change', (e) => {
    hideDrafts = e.target.checked;
    renderLayerFilters();
    renderCalendar();
  });

  document.getElementById('fillPageToggle').addEventListener('change', (e) => {
    fillPage = e.target.checked;
    updateFillPage();
  });

  // Paper size change
  document.getElementById('paperSize').addEventListener('change', (e) => {
    paperSize = e.target.value;
    updatePaperSize();
  });
  
  // Font size controls
  document.getElementById('fontSizeDecrease').addEventListener('click', () => {
    if (eventFontSize > 6) { // Minimum size
      eventFontSize--;
      updateFontSize();
    }
  });
  
  document.getElementById('fontSizeIncrease').addEventListener('click', () => {
    if (eventFontSize < 16) { // Maximum size
      eventFontSize++;
      updateFontSize();
    }
  });
  
  document.getElementById('fontSizeReset').addEventListener('click', () => {
    eventFontSize = 9; // Reset to default
    updateFontSize();
  });
}

// Identify unique calendar layers based on colors
function identifyLayers() {
  const colorGroups = new Map();
  
  allEvents.forEach(event => {
    const color = (event.backgroundColor || '#e9ecef').toUpperCase();
    if (!colorGroups.has(color)) {
      colorGroups.set(color, {
        color: color,
        events: [],
        sampleTitle: event.title,
        name: null  // Will be updated from HTML extraction
      });
    }
    colorGroups.get(color).events.push(event);
  });
  
  // Sort by number of events (most common first)
  const sortedLayers = Array.from(colorGroups.values()).sort((a, b) => b.events.length - a.events.length);
  
  console.log('Identified', sortedLayers.length, 'unique calendar layers by color');
  
  // Create layer info
  sortedLayers.forEach((layer, index) => {
    const layerId = `layer-${index}`;
    eventLayers.set(layer.color, {
      id: layerId,
      color: layer.color,
      count: layer.events.length,
      sampleTitle: layer.sampleTitle,
      name: null  // Will be set by updateLayerNames if available
    });
    enabledLayers.add(layer.color); // All enabled by default
    console.log('Layer', index, ':', layer.color, '-', layer.events.length, 'events, sample:', layer.sampleTitle.substring(0, 40));
  });
  
  renderLayerFilters();
  showDraftCount();
}

/* Drafts are only worth offering to hide when there are some. Saying how many
 * also makes it obvious the option did something, which a calendar with two
 * drafts in it otherwise would not. */
function showDraftCount() {
  const toggle = document.getElementById('hideDraftsToggle');
  if (!toggle) return;
  const label = toggle.parentElement;
  const drafts = allEvents.filter(isDraft).length;
  if (!drafts) {
    label.style.display = 'none';
    return;
  }
  label.style.display = 'flex';
  const text = label.querySelector('span');
  if (text) text.textContent = `Hide Drafts (${drafts})`;
}

// Update layer names from HTML data if available
function updateLayerNames(layerDataFromHTML) {
  console.log('[UPDATE LAYERS] ========== Starting Layer Name Update ==========');
  
  if (!layerDataFromHTML || !layerDataFromHTML.layers) {
    console.log('[UPDATE LAYERS] No layer names captured, so keeping colour labels');
    return;
  }
  
  console.log('[UPDATE LAYERS] Processing', layerDataFromHTML.layers.length, 'layers from HTML');
  console.log('[UPDATE LAYERS] Current eventLayers has', eventLayers.size, 'colors');
  
  // Show what colors we have in events
  console.log('[UPDATE LAYERS] Available event colors:');
  eventLayers.forEach((layer, color) => {
    console.log(`  - ${color}: ${layer.count} events`);
  });
  
  console.log('[UPDATE LAYERS] HTML layer data:');
  layerDataFromHTML.layers.forEach((layer, i) => {
    console.log(`  - ${layer.color}: "${layer.name}"`);
  });
  
  let matchCount = 0;
  layerDataFromHTML.layers.forEach((htmlLayer, index) => {
    const color = htmlLayer.color.toUpperCase();
    console.log(`[UPDATE LAYERS] ${index + 1}. Processing "${htmlLayer.name}" with color ${color}`);
    
    if (eventLayers.has(color)) {
      const layer = eventLayers.get(color);
      const oldName = layer.name || '(no name)';
      layer.name = htmlLayer.name;
      eventLayers.set(color, layer);
      matchCount++;
      console.log(`  MATCHED! Updated from "${oldName}" to "${htmlLayer.name}"`);
    } else {
      // Normal: a calendar layer with no events in the captured term has no
      // colour to match against. Not a fault, so don't log it as one.
      console.log(`  "${htmlLayer.name}" has no events in this term, so skipped`);
    }
  });
  
  console.log('[UPDATE LAYERS] ========================================');
  console.log('[UPDATE LAYERS] Successfully matched', matchCount, 'of', layerDataFromHTML.layers.length, 'layer names');
  console.log('[UPDATE LAYERS] ========================================');
  
  renderLayerFilters();
}

// What a layer amounts to as things currently stand: how many of its events
// would print, and one of them to name as an example. Both are worked out now
// rather than at load, so hiding drafts takes them off these labels too and
// cannot leave a hidden event standing as the sample.
function summariseLayer(color) {
  let count = 0;
  let sample = null;
  allEvents.forEach(event => {
    if (hideDrafts && isDraft(event)) return;
    if ((event.backgroundColor || '#e9ecef').toUpperCase() !== color) return;
    count++;
    if (sample === null) sample = event.title;
  });
  return { count: count, sample: sample };
}

// Render layer filter checkboxes
function renderLayerFilters() {
  const container = document.getElementById('layerFilters');
  
  // Keep the label
  const label = container.querySelector('.layer-filters-label');
  const hint = container.querySelector('span[style]');
  container.innerHTML = '';
  if (label) container.appendChild(label);
  if (hint) container.appendChild(hint);
  
  eventLayers.forEach((layer, color) => {
    const filterDiv = document.createElement('div');
    filterDiv.className = enabledLayers.has(color) ? 'layer-filter' : 'layer-filter disabled';
    filterDiv.style.borderColor = color;
    filterDiv.style.backgroundColor = `${color}22`;
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabledLayers.has(color);
    checkbox.id = layer.id;
    
    const colorBox = document.createElement('div');
    colorBox.className = 'layer-color-box';
    colorBox.style.backgroundColor = color;
    
    const labelElem = document.createElement('label');
    labelElem.htmlFor = layer.id;
    
    const summary = summariseLayer(color);
    const sample = summary.sample || layer.sampleTitle;
    
    // Use layer name if available, otherwise show event count
    const displayName = layer.name || `${summary.count} events`;
    labelElem.textContent = displayName;
    labelElem.style.cursor = 'pointer';
    
    // Show sample event in tooltip
    const tooltipText = layer.name 
      ? `${summary.count} events - Sample: ${sample}` 
      : `Sample: ${sample}`;
    labelElem.title = tooltipText;
    
    filterDiv.appendChild(checkbox);
    filterDiv.appendChild(colorBox);
    filterDiv.appendChild(labelElem);
    
    // Handle clicks on the entire filter div
    filterDiv.addEventListener('click', (e) => {
      // If clicking directly on the checkbox, let it handle itself
      if (e.target === checkbox) {
        // Checkbox will toggle automatically, we just need to update our state
        // Use setTimeout to let the checkbox state update first
        setTimeout(() => {
          updateLayerState(checkbox.checked, color, filterDiv);
        }, 0);
        return;
      }
      
      // If clicking the label, it will automatically toggle the checkbox via htmlFor
      // So we just need to update our state
      if (e.target === labelElem) {
        // The checkbox will be toggled by the label's native behavior
        // Use setTimeout to let that happen first
        setTimeout(() => {
          updateLayerState(checkbox.checked, color, filterDiv);
        }, 0);
        return;
      }
      
      // For everything else (color box, background), manually toggle
      checkbox.checked = !checkbox.checked;
      updateLayerState(checkbox.checked, color, filterDiv);
    });
    
    // Helper function to update layer state
    function updateLayerState(isChecked, layerColor, div) {
      if (isChecked) {
        enabledLayers.add(layerColor);
        div.classList.remove('disabled');
      } else {
        enabledLayers.delete(layerColor);
        div.classList.add('disabled');
      }
      renderCalendar();
    }
    
    container.appendChild(filterDiv);
  });
}

// Filter events based on enabled layers, and on whether drafts are wanted
function getFilteredEvents() {
  return allEvents.filter(event => {
    if (hideDrafts && isDraft(event)) return false;
    const color = (event.backgroundColor || '#e9ecef').toUpperCase();
    return enabledLayers.has(color);
  });
}

// Parse Australian date format DD/MM/YYYY
function parseAUDate(dateStr) {
  const parts = dateStr.split('/');
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

// Populate term filter
function populateTermFilter() {
  const termFilter = document.getElementById('termFilter');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let currentTermId = null;
  
  if (allTerms.length > 0) {
    allTerms.forEach(term => {
      const option = document.createElement('option');
      option.value = `term-${term.id}`;
      option.textContent = `${term.name} ${term.year}`;
      termFilter.appendChild(option);
      
      // Check if today falls within this term
      if (today >= term.startDate && today <= term.endDate) {
        currentTermId = term.id;
      }
    });
    
    // Select the current term if found
    if (currentTermId) {
      termFilter.value = `term-${currentTermId}`;
    }
  }
  
  const years = [...new Set(allEvents.map(e => e.startDate.getFullYear()))].sort();
  years.forEach(year => {
    const option = document.createElement('option');
    option.value = `year-${year}`;
    option.textContent = `Year ${year}`;
    termFilter.appendChild(option);
  });
}

// Render calendar based on view mode
function renderCalendar() {
  const termFilterValue = document.getElementById('termFilter').value;
  const filteredEvents = getFilteredEvents();
  let displayEvents = filteredEvents;
  
  if (termFilterValue !== 'all') {
    if (termFilterValue.startsWith('term-')) {
      const termId = parseInt(termFilterValue.replace('term-', ''));
      const term = allTerms.find(t => t.id === termId);
      if (term) {
        // Include events that overlap with the term period
        displayEvents = filteredEvents.filter(e => 
          e.startDate <= term.endDate && e.endDate >= term.startDate
        );
        document.getElementById('calendarTitle').textContent = `${term.name} ${term.year}`;
      }
    } else if (termFilterValue.startsWith('year-')) {
      const year = parseInt(termFilterValue.replace('year-', ''));
      displayEvents = filteredEvents.filter(e => e.startDate.getFullYear() === year);
      document.getElementById('calendarTitle').textContent = `${year} School Calendar`;
    }
  } else {
    document.getElementById('calendarTitle').textContent = 'School Term Calendar';
  }

  if (currentView === 'term') {
    renderTermCalendarView(displayEvents);
  } else if (currentView === 'monthly') {
    renderMonthlyCalendarView(displayEvents);
  } else if (currentView === 'weekly') {
    renderWeeklyView(displayEvents);
  } else if (currentView === 'daily') {
    renderDailyView(displayEvents);
  }
}

// Term Calendar View - Shows all weeks in each term
function renderTermCalendarView(events) {
  const content = document.getElementById('calendarContent');
  
  if (allTerms.length === 0) {
    content.innerHTML = '<p class="no-events">No term data available.</p>';
    return;
  }
  
  let html = '';
  
  const selectedFilter = document.getElementById('termFilter').value;
  const termsToShow = selectedFilter.startsWith('term-') 
    ? allTerms.filter(t => `term-${t.id}` === selectedFilter)
    : allTerms;
  
  termsToShow.forEach(term => {
    // Include events that overlap with the term (not just those that start within it)
    // An event overlaps if: event starts before term ends AND event ends after term starts
    const termEvents = events.filter(e => 
      e.startDate <= term.endDate && e.endDate >= term.startDate
    );
    
    html += `<div class="term-section">`;
    html += `<div class="term-header">${term.name} ${term.year} (${formatDate(term.startDate)} - ${formatDate(term.endDate)})</div>`;
    html += renderCalendarGrid(term.startDate, term.endDate, termEvents, true);
    html += `</div>`;
  });
  
  content.innerHTML = html || '<p class="no-events">No events to display</p>';
}

// Monthly Calendar View
function renderMonthlyCalendarView(events) {
  const content = document.getElementById('calendarContent');
  const monthGroups = groupByMonth(events);
  
  let html = '';
  monthGroups.forEach((monthEvents, monthKey) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(year, month - 1, 1);
    const monthName = date.toLocaleString('default', { month: 'long', year: 'numeric' });
    
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    
    html += `<div class="term-section">`;
    html += `<div class="term-header">${monthName}</div>`;
    html += renderCalendarGrid(firstDay, lastDay, monthEvents, false);
    html += `</div>`;
  });
  
  content.innerHTML = html || '<p class="no-events">No events to display</p>';
}

// Render calendar grid
function renderCalendarGrid(startDate, endDate, events, showTermWeeks = false) {
  let html = '<div class="calendar-grid">';
  
  // Determine which days to show
  const daysToShow = hideWeekends 
    ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  const numDays = daysToShow.length;
  const headerClass = hideWeekends ? 'calendar-header hide-weekends' : 'calendar-header';
  const weekClass = hideWeekends ? 'calendar-week hide-weekends' : 'calendar-week';
  
  // Header row
  html += `<div class="${headerClass}">`;
  if (showTermWeeks) {
    html += '<div class="week-header-spacer"></div>';
  }
  daysToShow.forEach(day => {
    html += `<div class="day-name">${day}</div>`;
  });
  html += '</div>';
  
  // Find the first Monday on or before startDate
  const firstDay = new Date(startDate);
  const dayOfWeek = firstDay.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  firstDay.setDate(firstDay.getDate() - daysToMonday);
  
  // Find the last day to display
  const lastDay = new Date(endDate);
  if (hideWeekends) {
    // Find the last Friday on or after endDate
    const dayOfWeekEnd = lastDay.getDay();
    if (dayOfWeekEnd === 0) { // Sunday
      lastDay.setDate(lastDay.getDate() - 2); // Go back to Friday
    } else if (dayOfWeekEnd === 6) { // Saturday
      lastDay.setDate(lastDay.getDate() - 1); // Go back to Friday
    } else if (dayOfWeekEnd < 5) { // Monday-Thursday
      lastDay.setDate(lastDay.getDate() + (5 - dayOfWeekEnd)); // Go forward to Friday
    }
  } else {
    // Find the last Sunday on or after endDate
    const daysToSunday = lastDay.getDay() === 0 ? 0 : 7 - lastDay.getDay();
    lastDay.setDate(lastDay.getDate() + daysToSunday);
  }
  
  const currentDate = new Date(firstDay);
  let termWeekNumber = 1;
  
  while (currentDate <= lastDay) {
    // Build array of days for this week
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(currentDate);
      dayDate.setDate(dayDate.getDate() + i);
      weekDays.push(dayDate);
    }
    
    // Get all events for this week and categorize them
    const weekEvents = getWeekEvents(events, weekDays);
    
    // Height of the row is driven by the busiest visible day in it, so a quiet
    // week takes only the space it needs. Hidden weekends don't count.
    const weekRows = Math.max(MIN_WEEK_ROWS, countBusiestDay(weekEvents));
    
    html += `<div class="${weekClass}" style="--week-rows: ${weekRows};">`;
    
    // Add week number for term view
    if (showTermWeeks) {
      html += `<div class="week-number">Week ${termWeekNumber}</div>`;
    }
    
    // Render each day (skip weekends if hidden)
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dayDate = weekDays[dayIndex];
      const dayOfWeekNum = dayDate.getDay();
      const isWeekend = dayOfWeekNum === 0 || dayOfWeekNum === 6;
      
      // Skip weekends if hideWeekends is enabled
      if (hideWeekends && isWeekend) continue;
      
      const dayEventsData = weekEvents[dayIndex];
      const isOtherMonth = dayDate < startDate || dayDate > endDate;
      
      let dayClass = 'calendar-day';
      if (isOtherMonth) dayClass += ' other-month';
      if (isWeekend) dayClass += ' weekend';
      
      html += `<div class="${dayClass}">`;
      html += `<div class="day-number">${dayDate.getDate()}<span class="month-abbr">${getMonthAbbr(dayDate)}</span></div>`;
      html += '<div class="day-events">';
      
      // Multi-day events (show on all days they span)
      dayEventsData.multiDay.forEach(eventInfo => {
        const event = eventInfo.event;
        const bgColor = event.backgroundColor || '#e9ecef';
        const textColor = getTextColorForBackground(bgColor);
        const time = event.allDay ? '' : formatTime(event.startDate);
        
        html += `<div class="calendar-event" style="border-left-color: ${bgColor}; background-color: ${bgColor}; color: ${textColor}; font-weight: 500;">`;
        if (time && eventInfo.isStartDay) {
          html += `<span class="event-time">${time}</span>`;
        }
        html += escapeHtml(event.title);
        if (!eventInfo.isStartDay) html += ' →';
        html += '</div>';
      });
      
      // Single day events
      dayEventsData.singleDay.forEach(event => {
        const bgColor = event.backgroundColor || '#e9ecef';
        const bgColorWithAlpha = bgColor + '22'; // Add transparency
        const textColor = getTextColorForBackground(bgColorWithAlpha); // Calculate based on transparent color
        const time = event.allDay ? '' : formatTime(event.startDate);
        html += `<div class="calendar-event" style="border-left-color: ${bgColor}; background-color: ${bgColorWithAlpha}; color: ${textColor};">`;
        if (time) html += `<span class="event-time">${time}</span>`;
        html += escapeHtml(event.title);
        html += '</div>';
      });
      
      html += '</div></div>';
    }
    
    html += '</div>';
    currentDate.setDate(currentDate.getDate() + 7);
    termWeekNumber++;
  }
  
  html += '</div>';
  return html;
}

// How many event chips the fullest day in this week needs. Weekend columns are
// skipped when they're hidden, so hiding them can also shorten the row.
function countBusiestDay(weekEvents) {
  let mostRows = 0;
  
  weekEvents.forEach((dayEventsData, dayIndex) => {
    // weekDays[0] is Monday, so Saturday and Sunday are indexes 5 and 6.
    const isWeekend = dayIndex >= 5;
    if (hideWeekends && isWeekend) return;
    
    const rows = dayEventsData.multiDay.length + dayEventsData.singleDay.length;
    if (rows > mostRows) mostRows = rows;
  });
  
  return mostRows;
}

// Get all events for a week, categorized by day
function getWeekEvents(events, weekDays) {
  const weekEvents = weekDays.map(() => ({ multiDay: [], singleDay: [] }));
  
  events.forEach(event => {
    const eventStart = new Date(event.startDate);
    eventStart.setHours(0, 0, 0, 0);
    const eventEnd = new Date(event.endDate);
    eventEnd.setHours(23, 59, 59, 999);
    
    const isMultiDay = !isSameDay(event.startDate, event.endDate);
    
    weekDays.forEach((dayDate, dayIndex) => {
      const checkDate = new Date(dayDate);
      checkDate.setHours(12, 0, 0, 0);
      
      // Check if event occurs on this day
      if (checkDate >= eventStart && checkDate <= eventEnd) {
        if (isMultiDay) {
          weekEvents[dayIndex].multiDay.push({
            event: event,
            isStartDay: isSameDay(event.startDate, dayDate),
            isEndDay: isSameDay(event.endDate, dayDate)
          });
        } else if (isSameDay(event.startDate, dayDate)) {
          weekEvents[dayIndex].singleDay.push(event);
        }
      }
    });
  });
  
  return weekEvents;
}

// Weekly list view
function renderWeeklyView(events) {
  const content = document.getElementById('calendarContent');
  const weeks = groupByWeek(events);
  
  let html = '';
  weeks.forEach((weekEvents, weekKey) => {
    const [year, week] = weekKey.split('-W');
    const weekStart = getDateOfWeek(parseInt(week), parseInt(year));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    html += `<div class="week">`;
    html += `<div class="week-header">Week ${week}, ${year} (${formatDate(weekStart)} - ${formatDate(weekEnd)})</div>`;
    
    const dayGroups = groupByDay(weekEvents);
    dayGroups.forEach((dayEvents, dayKey) => {
      const date = new Date(dayKey);
      html += `<div class="day">`;
      html += `<div class="day-header">${formatDayHeader(date)}</div>`;
      
      if (dayEvents.length === 0) {
        html += `<div class="no-events">No events</div>`;
      } else {
        dayEvents.forEach(event => {
          html += formatEvent(event);
        });
      }
      html += `</div>`;
    });
    html += `</div>`;
  });
  
  content.innerHTML = html || '<p class="no-events">No events to display</p>';
}

// Daily list view
function renderDailyView(events) {
  const content = document.getElementById('calendarContent');
  const dayGroups = groupByDay(events);
  
  let html = '';
  dayGroups.forEach((dayEvents, dayKey) => {
    const date = new Date(dayKey);
    html += `<div class="week">`;
    html += `<div class="week-header">${formatDayHeader(date)}</div>`;
    
    if (dayEvents.length === 0) {
      html += `<div class="no-events">No events</div>`;
    } else {
      dayEvents.forEach(event => {
        html += formatEvent(event);
      });
    }
    html += `</div>`;
  });
  
  content.innerHTML = html || '<p class="no-events">No events to display</p>';
}

// Format event for list views
function formatEvent(event) {
  const bgColor = event.backgroundColor || '#e9ecef';
  const time = event.allDay 
    ? 'All Day' 
    : `${formatTime(event.startDate)} - ${formatTime(event.endDate)}`;
  
  // For list view, background is semi-transparent, so use dark text
  return `
    <div class="event" style="border-left-color: ${bgColor}; background-color: ${bgColor}22;">
      <div class="event-title" style="color: #333;">${escapeHtml(event.title)}</div>
      <div class="event-time">${time}</div>
      ${event.location ? `<div class="event-description">${CompassToolkitIcons.markup('mapPin', 12)}<span>${escapeHtml(event.location)}</span></div>` : ''}
      ${event.description ? `<div class="event-description">${escapeHtml(event.description)}</div>` : ''}
    </div>
  `;
}

// Grouping functions
function groupByWeek(events) {
  const groups = new Map();
  events.forEach(event => {
    const weekKey = getWeekKey(event.startDate);
    if (!groups.has(weekKey)) {
      groups.set(weekKey, []);
    }
    groups.get(weekKey).push(event);
  });
  return groups;
}

function groupByDay(events) {
  const groups = new Map();
  events.forEach(event => {
    const dayKey = event.startDate.toISOString().split('T')[0];
    if (!groups.has(dayKey)) {
      groups.set(dayKey, []);
    }
    groups.get(dayKey).push(event);
  });
  return new Map([...groups.entries()].sort());
}

function groupByMonth(events) {
  const groups = new Map();
  events.forEach(event => {
    const monthKey = `${event.startDate.getFullYear()}-${String(event.startDate.getMonth() + 1).padStart(2, '0')}`;
    if (!groups.has(monthKey)) {
      groups.set(monthKey, []);
    }
    groups.get(monthKey).push(event);
  });
  return new Map([...groups.entries()].sort());
}

// Utility functions
function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

// Calculate if a color is light (for text contrast)
function isLightColor(color) {
  let r, g, b, a = 1; // Default alpha to fully opaque
  
  // Handle RGB/RGBA format: rgb(204, 255, 204) or rgba(204, 255, 204, 0.5)
  if (color.startsWith('rgb')) {
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (rgbaMatch) {
      r = parseInt(rgbaMatch[1]);
      g = parseInt(rgbaMatch[2]);
      b = parseInt(rgbaMatch[3]);
      a = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
    } else {
      return false; // Default to dark if can't parse
    }
  } 
  // Handle hex format: #CCFFCC or #CCFFCC22 (with alpha)
  else if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    r = parseInt(hex.substr(0, 2), 16);
    g = parseInt(hex.substr(2, 2), 16);
    b = parseInt(hex.substr(4, 2), 16);
    
    // Check if there's an alpha channel (8-digit hex)
    if (hex.length === 8) {
      a = parseInt(hex.substr(6, 2), 16) / 255; // Convert to 0-1 range
    }
  }
  else {
    return false; // Unknown format, default to dark
  }
  
  // If color has transparency, blend it with white background
  // This simulates how the color actually appears on screen
  if (a < 1) {
    // Alpha blending: resultColor = (foreground * alpha) + (background * (1 - alpha))
    // Assuming white background (255, 255, 255)
    r = Math.round(r * a + 255 * (1 - a));
    g = Math.round(g * a + 255 * (1 - a));
    b = Math.round(b * a + 255 * (1 - a));
  }
  
  // Calculate relative luminance (perceived brightness)
  // Using the formula from WCAG guidelines
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // If luminance is greater than 0.6, it's a light color
  return luminance > 0.6;
}

// Get text color for a background color (black for light backgrounds, white for dark)
function getTextColorForBackground(bgColor) {
  return isLightColor(bgColor) ? '#000000' : '#ffffff';
}

function getWeekKey(date) {
  const weekNum = getWeekNumber(date);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getDateOfWeek(week, year) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = simple.getDay();
  const ISOweekStart = simple;
  if (dow <= 4) {
    ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
  }
  return ISOweekStart;
}

function formatDate(date) {
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function formatDayHeader(date) {
  return date.toLocaleDateString('en-AU', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

function formatTime(date) {
  return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function getMonthAbbr(date) {
  return date.toLocaleDateString('en-AU', { month: 'short' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}