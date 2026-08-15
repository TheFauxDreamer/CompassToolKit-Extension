// Try to get data from various sources
function initializePrint() {
    console.log('[Timetable Print] Initializing print page');

    if (!chrome || !chrome.storage || !chrome.storage.local) {
        console.error('[Timetable Print] Chrome storage API not available');
        tryFallbackData();
        return;
    }

    const KEYS = CompassToolkit.DATA_KEYS;

    // The captured page data and the user's print preference live in different
    // storage areas, so fetch both before rendering.
    Promise.all([
        CompassToolkit.getData([KEYS.periods, KEYS.events, KEYS.student, KEYS.school]),
        CompassToolkit.getSettings()
    ]).then(function ([data, settings]) {
        const result = {
            periodsData: data[KEYS.periods],
            eventsData: data[KEYS.events],
            studentInfo: data[KEYS.student],
            schoolInfo: data[KEYS.school],
            quickPrint: !!settings.timetablePrinter.quickPrint
        };

        console.log('[Timetable Print] Chrome storage result:', {
            hasPeriodsData: !!result.periodsData,
            hasEventsData: !!result.eventsData,
            hasStudentInfo: !!result.studentInfo,
            hasSchoolInfo: !!result.schoolInfo
        });

        if (result.periodsData && result.eventsData) {
            console.log('[Timetable Print] Data retrieved from storage');
            renderTimetable(result);
        } else {
            // Fallback: try data passed directly on the window object
            console.log('[Timetable Print] Storage empty, trying window.timetableData fallback');
            tryFallbackData();
        }
    });
}

function showNoData() {
    console.log('[Timetable Print] Showing no data message');
    document.getElementById('timetableContent').innerHTML = 
        '<p style="text-align: center; color: #999; padding: 40px;">No timetable data available. Please try clicking the print button again.</p>';
}

// Fallback: read data from window.timetableData (set by content.js on the popup)
function tryFallbackData() {
    if (window.timetableData && window.timetableData.periods && window.timetableData.events) {
        console.log('[Timetable Print] Using window.timetableData fallback');
        const result = {
            periodsData: window.timetableData.periods,
            eventsData: window.timetableData.events,
            studentInfo: window.timetableData.studentInfo || {},
            schoolInfo: window.timetableData.schoolInfo || {},
            quickPrint: false
        };
        renderTimetable(result);
    } else {
        console.error('[Timetable Print] No fallback data available');
        showNoData();
    }
}

// Shared rendering logic used by both storage and fallback paths
function renderTimetable(result) {
    console.log('[Timetable Print] Data retrieved successfully');
    const studentInfo = result.studentInfo || {};
    const schoolInfo = result.schoolInfo || {};
    const data = {
        periods: result.periodsData,
        events: result.eventsData,
        studentInfo: studentInfo,
        schoolInfo: schoolInfo,
        isStaff: !!studentInfo.isStaff
    };

    // Apply school name and logo before generating timetable
    if (schoolInfo.name) {
        document.getElementById('schoolName').textContent = schoolInfo.name;
    }
    if (schoolInfo.logoUrl) {
        const logo = document.getElementById('schoolLogo');
        logo.src = schoolInfo.logoUrl;
        logo.style.display = 'inline-block';
        logo.onerror = () => { logo.style.display = 'none'; };
    }

    generateTimetable(data);

    // Quick print: open print dialogue immediately
    if (result.quickPrint) {
        // Hide controls since we're going straight to print
        const controls = document.querySelector('.controls');
        if (controls) controls.style.display = 'none';
        window.print();
    }
}

// Initialize when page loads
console.log('[Timetable Print] Script loaded');

function setupButtons() {
    console.log('[Timetable Print] Setting up buttons');
    
    const printBtn = document.getElementById('printBtn');
    const closeBtn = document.getElementById('closeBtn');
    const bwCheckbox = document.getElementById('bwModeCheckbox');
    
    console.log('[Timetable Print] Elements found:', {
        printBtn: !!printBtn,
        closeBtn: !!closeBtn,
        bwCheckbox: !!bwCheckbox
    });
    
    // Apply B&W mode by default since checkbox is checked
    if (bwCheckbox && bwCheckbox.checked) {
        console.log('[Timetable Print] Applying default B&W mode');
        document.body.classList.add('bw-mode');
    }
    
    if (bwCheckbox) {
        bwCheckbox.addEventListener('change', function() {
            console.log('[Timetable Print] B&W mode toggled:', this.checked);
            if (this.checked) {
                document.body.classList.add('bw-mode');
            } else {
                document.body.classList.remove('bw-mode');
            }
            console.log('[Timetable Print] Body has bw-mode class:', document.body.classList.contains('bw-mode'));
        });
    }
    
    if (printBtn) {
        printBtn.addEventListener('click', function() {
            console.log('[Timetable Print] Print button clicked');
            window.print();
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            console.log('[Timetable Print] Close button clicked');
            window.close();
        });
    }
}

// Set up buttons and initialize timetable
if (document.readyState === 'loading') {
    console.log('[Timetable Print] Waiting for DOM');
    document.addEventListener('DOMContentLoaded', function() {
        setupButtons();
        initializePrint();
    });
} else {
    console.log('[Timetable Print] DOM ready, initializing now');
    setupButtons();
    initializePrint();
}

function generateTimetable(data) {
    console.log('[Timetable Print] Generating timetable');
    console.log('[Timetable Print] Data received:', {
        hasPeriods: !!data.periods,
        hasEvents: !!data.events,
        periodsType: typeof data.periods,
        eventsType: typeof data.events
    });
    
    if (!data.periods || !data.periods.d) {
        console.error('[Timetable Print] Invalid periods data structure');
        showNoData();
        return;
    }
    
    if (!data.events || !data.events.d) {
        console.error('[Timetable Print] Invalid events data structure');
        showNoData();
        return;
    }
    
    const periodsData = data.periods.d;
    
    // Filter out unwanted events like meetings and sickbay before processing
    const events = data.events.d.filter(event => {
        const title = (event.title || '').toLowerCase();
        const subject = (event.subjectLongName || '').toLowerCase();
        
        // Check for excursion background colour (#ccffcc)
        const bgColor = (event.backgroundColor || event.bc || '').toLowerCase().replace(/\s/g, '');
        const isExcursion = bgColor === '#ccffcc';

        // Check for keywords (add or remove keywords here as needed)
        const isUnwanted =
            isExcursion ||
            title.includes('meeting') ||
            subject.includes('meeting') ||
            title.includes('withdrawn') ||
            subject.includes('withdrawn') ||
            title.includes('withdrawl') ||
            subject.includes('withdrawl') ||
            title.includes('sickbay') ||
            subject.includes('sickbay') ||
            title.includes('sick bay') ||
            subject.includes('sick bay');

        // Keep the event only if it's NOT unwanted
        return !isUnwanted;
    });
    
    const isStaff = !!data.isStaff;
    console.log('[Timetable Print] Processing', events.length, 'events', isStaff ? '(staff mode)' : '(student mode)');

    // Auto-detect the main student timetable structure ID.
    // Different Compass schools may use different IDs; the main student
    // timetable is always the one with the most periods across all days.
    const structurePeriodCounts = {};
    periodsData.forEach(dayData => {
        if (dayData.periods && dayData.timetableStructureId != null) {
            const sid = dayData.timetableStructureId;
            if (!structurePeriodCounts[sid]) structurePeriodCounts[sid] = 0;
            structurePeriodCounts[sid] += dayData.periods.length;
        }
    });
    const mainStructureId = Object.entries(structurePeriodCounts)
        .sort((a, b) => b[1] - a[1])
        .map(e => Number(e[0]))[0];
    console.log('[Timetable Print] Auto-detected main timetable structure ID:', mainStructureId,
        '(candidates:', structurePeriodCounts, ')');

    // Build a map of all periods with their details (including lunch breaks)
    const periodDefinitions = {};
    const days = new Set();
    
    periodsData.forEach(dayData => {
        if (dayData.periods && dayData.timetableStructureId === mainStructureId) {
            const dayKey = new Date(dayData.day).toISOString().split('T')[0];
            days.add(dayKey);
            
            if (!periodDefinitions[dayKey]) {
                periodDefinitions[dayKey] = {};
            }
            
            dayData.periods.forEach(period => {
                const periodKey = period.c; // Using 'c' as the period identifier
                periodDefinitions[dayKey][periodKey] = {
                    name: period.n,
                    start: period.s,
                    finish: period.f,
                    isLunch: !period.teachingTime && /lunch|recess|break/i.test(period.n),
                    periodNumber: period.pn
                };
            });
        }
    });

    // Group events by day and period - allow multiple events per period
    const eventsByDayAndPeriod = {};
    
    events.forEach(event => {
        const date = new Date(event.start);
        const dayKey = date.toISOString().split('T')[0];
        
        // Use period key from event, or try to match by time if no period is specified
        let periodKey = event.c || event.period;
        let isSpecialClass = false;
        
        // If no period key, try to find the matching period by checking which period this time falls into
        if (!periodKey && periodDefinitions[dayKey]) {
            isSpecialClass = true; // Mark as special since it doesn't have a regular period assignment
            const eventStartTime = new Date(event.start);
            // Get UTC time and manually convert to Perth (UTC+8)
            let eventHour = eventStartTime.getUTCHours() + 8;
            const eventMinute = eventStartTime.getUTCMinutes();
            if (eventHour >= 24) eventHour -= 24;
            const eventTimeInMinutes = eventHour * 60 + eventMinute;
            
            console.log('[Timetable Print] Looking for period for event at', formatTime(event.start), '(', eventTimeInMinutes, 'minutes)');
            
            for (const [pKey, periodDef] of Object.entries(periodDefinitions[dayKey])) {
                if (periodDef.isLunch && !isStaff) continue; // Skip lunch periods for students
                
                const periodStart = new Date(periodDef.start);
                const periodFinish = new Date(periodDef.finish);
                // Get UTC time and manually convert to Perth (UTC+8)
                let periodStartHour = periodStart.getUTCHours() + 8;
                if (periodStartHour >= 24) periodStartHour -= 24;
                const periodStartMinutes = periodStartHour * 60 + periodStart.getUTCMinutes();
                
                let periodFinishHour = periodFinish.getUTCHours() + 8;
                if (periodFinishHour >= 24) periodFinishHour -= 24;
                const periodFinishMinutes = periodFinishHour * 60 + periodFinish.getUTCMinutes();
                
                console.log('[Timetable Print] Checking period', periodDef.name, ':', periodStartMinutes, '-', periodFinishMinutes, 'minutes');
                
                // Check if event time falls within or just before this period (within 5 minutes)
                // This handles music lessons that start slightly before the regular period
                if (eventTimeInMinutes >= (periodStartMinutes - 5) && eventTimeInMinutes < periodFinishMinutes) {
                    periodKey = pKey;
                    console.log('[Timetable Print] Matched to period', periodDef.name);
                    break;
                }
            }
            
            if (!periodKey) {
                console.log('[Timetable Print] No period match found for event at', formatTime(event.start));
            }
        }
        
        if (periodKey) {
            if (!eventsByDayAndPeriod[dayKey]) {
                eventsByDayAndPeriod[dayKey] = {};
            }
            
            if (!eventsByDayAndPeriod[dayKey][periodKey]) {
                eventsByDayAndPeriod[dayKey][periodKey] = [];
            }
            
            // Mark the event as special if needed
            event._isSpecialClass = isSpecialClass;
            
            eventsByDayAndPeriod[dayKey][periodKey].push(event);
        }
    });

    // Get all unique period keys across all days and sort them
    const allPeriodKeys = new Set();
    Object.values(periodDefinitions).forEach(dayPeriods => {
        Object.keys(dayPeriods).forEach(key => allPeriodKeys.add(key));
    });
    
    const sortedPeriods = Array.from(allPeriodKeys).sort((a, b) => {
        // Get period numbers from any day's definition
        let aPeriod = null;
        let bPeriod = null;
        
        for (const dayPeriods of Object.values(periodDefinitions)) {
            if (dayPeriods[a]) aPeriod = dayPeriods[a];
            if (dayPeriods[b]) bPeriod = dayPeriods[b];
            if (aPeriod && bPeriod) break;
        }
        
        if (aPeriod && bPeriod) {
            return aPeriod.periodNumber - bPeriod.periodNumber;
        }
        return String(a).localeCompare(String(b));
    });

    const sortedDays = Array.from(days).sort();
    console.log('[Timetable Print] Found', sortedDays.length, 'days and', sortedPeriods.length, 'periods');

    // Build the table
    let html = '<div class="week-container">';
    html += '<table class="timetable">';
    
    // Header row with days
    html += '<thead><tr>';
    html += '<th class="period-header">Period</th>';
    
    sortedDays.forEach(dayKey => {
        const date = new Date(dayKey);
        const dayName = date.toLocaleDateString('en-AU', { weekday: 'long' });
        html += `<th>${dayName}</th>`;
    });
    
    html += '</tr></thead><tbody>';
    
    // Data rows - one for each period
    sortedPeriods.forEach(periodKey => {
        // Get period definition from first available day
        let periodDef = null;
        for (const dayKey of sortedDays) {
            if (periodDefinitions[dayKey] && periodDefinitions[dayKey][periodKey]) {
                periodDef = periodDefinitions[dayKey][periodKey];
                break;
            }
        }
        
        if (!periodDef) return; // Skip if no definition found
        
        const isLunch = periodDef.isLunch;
        const periodName = periodDef.name;
        const timeRange = periodDef.start && periodDef.finish 
            ? `${formatTime(periodDef.start)} - ${formatTime(periodDef.finish)}` 
            : '';
        
        html += `<tr>`;
        html += `<td class="period-header"><strong>${periodName}</strong>`;
        if (timeRange) {
            html += `<span class="period-time">${timeRange}</span>`;
        }
        html += `</td>`;
        
        // Add cell for each day
        sortedDays.forEach(dayKey => {
            const events = eventsByDayAndPeriod[dayKey] ? eventsByDayAndPeriod[dayKey][periodKey] : null;
            
            if (isLunch && isStaff && events && events.length > 0) {
                // Staff member with a lunch duty - show the duty instead of generic lunch
                html += `<td class="class-cell lunch-duty">`;
                const sortedEvents = events.sort((a, b) =>
                    new Date(a.start) - new Date(b.start)
                );
                sortedEvents.forEach((event, index) => {
                    if (index > 0) {
                        html += `<div class="class-separator"></div>`;
                    }
                    if (event.subjectLongName) {
                        html += `<div class="subject-name">${event.subjectLongName}</div>`;
                    }
                    html += `<div class="subject-code">${event.title || '-'}</div>`;
                    const location = event.locations && event.locations[0] ? event.locations[0].locationName : '';
                    if (location) {
                        html += `<div class="location"><strong>Room:</strong> ${location}</div>`;
                    }
                });
                html += `</td>`;
            } else if (isLunch) {
                // Student or staff with no duty - show generic lunch
                html += `<td class="lunch-break">Lunch</td>`;
            } else if (events && events.length > 0) {
                // Sort events by start time so they appear in chronological order
                const sortedEvents = events.sort((a, b) => 
                    new Date(a.start) - new Date(b.start)
                );
                
                // There are one or more classes scheduled
                html += `<td class="class-cell">`;
                
                // Display each event
                sortedEvents.forEach((event, index) => {
                    if (index > 0) {
                        html += `<div class="class-separator"></div>`;
                    }
                    
                    // Add special class wrapper if this is a special class
                    const isSpecial = event._isSpecialClass;
                    if (isSpecial) {
                        html += `<div class="special-class">`;
                        // Add time for special classes
                        const startTime = formatTime(event.start);
                        const endTime = formatTime(event.finish);
                        html += `<div class="special-time">${startTime} - ${endTime}</div>`;
                    }
                    
                    if (event.subjectLongName) {
                        html += `<div class="subject-name">${event.subjectLongName}</div>`;
                    }
                    html += `<div class="subject-code">${event.title || '-'}</div>`;
                    const location = event.locations && event.locations[0] ? event.locations[0].locationName : '';
                    if (location) {
                        html += `<div class="location"><strong>Room:</strong> ${location}</div>`;
                    }
                    
                    // Always show the original teacher (not relief teacher)
                    const teacherName = event.managers && event.managers[0] && event.managers[0].managerImportIdentifier 
                        ? formatTeacherName(event.managers[0].managerImportIdentifier)
                        : '';
                    
                    if (teacherName) {
                        html += `<div class="teacher"><strong>Teacher:</strong> ${teacherName}</div>`;
                    }
                    
                    if (isSpecial) {
                        html += `</div>`; // Close special-class wrapper
                    }
                });
                
                html += `</td>`;
            } else {
                // Empty period
                html += `<td class="empty-cell">-</td>`;
            }
        });
        
        html += `</tr>`;
    });
    
    html += '</tbody></table></div>';

    document.getElementById('timetableContent').innerHTML = html;

    // Set student name and print date in header
    const studentInfo = data.studentInfo || {};
    let studentText = '';
    
    if (studentInfo.name) {
        studentText = studentInfo.name;
        if (studentInfo.yearGroup || studentInfo.faction) {
            studentText += ' — ';
            const details = [];
            if (studentInfo.yearGroup) details.push(studentInfo.yearGroup);
            if (studentInfo.faction) details.push(studentInfo.faction);
            studentText += details.join(', ');
        }
    } else {
        studentText = isStaff ? 'Staff Timetable' : 'Student Timetable';
    }
    
    const studentNameEl = document.getElementById('studentName');
    if (studentNameEl) studentNameEl.textContent = studentText;
    document.getElementById('studentInfo').textContent = 
        `Printed: ${new Date().toLocaleDateString('en-AU')}`;
    
    console.log('[Timetable Print] Timetable generated successfully');
}

function formatTime(timeString) {
    // Parse UTC time and convert to Perth time (UTC+8)
    const date = new Date(timeString);
    
    // Extract UTC time components
    const utcHours = date.getUTCHours();
    const utcMinutes = date.getUTCMinutes();
    
    // Add 8 hours for Perth timezone (UTC+8)
    let perthHours = utcHours + 8;
    let perthMinutes = utcMinutes;
    
    // Handle day overflow (if hours >= 24)
    if (perthHours >= 24) {
        perthHours -= 24;
    }
    
    // Format as HH:MM
    return `${perthHours.toString().padStart(2, '0')}:${perthMinutes.toString().padStart(2, '0')}`;
}

function formatTeacherName(name) {
    if (!name || name.length < 2) return name;
    // Remove first letter and capitalize the second
    return name.charAt(1).toUpperCase() + name.slice(2);
}