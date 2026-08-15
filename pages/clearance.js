// Initialize clearance form
function initializeClearanceForm() {
    console.log('[Clearance Form] Initializing');

    if (!chrome || !chrome.storage || !chrome.storage.local) {
        console.error('[Clearance Form] Chrome storage API not available');
        showNoData();
        return;
    }

    const KEYS = CompassToolkit.DATA_KEYS;

    // The captured page data and the user's print preference live in different
    // storage areas, so fetch both before rendering.
    Promise.all([
        CompassToolkit.getData([KEYS.events, KEYS.student, KEYS.school]),
        CompassToolkit.getSettings()
    ]).then(function ([data, settings]) {
        const eventsData = data[KEYS.events];
        const studentInfo = data[KEYS.student];

        console.log('[Clearance Form] Chrome storage result:', {
            hasEventsData: !!eventsData,
            hasStudentInfo: !!studentInfo,
            hasSchoolInfo: !!data[KEYS.school]
        });

        if (!eventsData || !studentInfo) {
            console.error('[Clearance Form] No data in storage');
            showNoData();
            return;
        }

        console.log('[Clearance Form] Data retrieved successfully');
        generateClearanceForm({
            events: eventsData,
            studentInfo: studentInfo,
            schoolInfo: data[KEYS.school] || {}
        });

        // If quick print is enabled, wait for logo to load then print
        if (settings.clearanceForm.quickPrint) {
            console.log('[Clearance Form] Quick print enabled');
            const logo = document.getElementById('schoolLogo');
            if (logo && logo.src && logo.style.display !== 'none') {
                logo.addEventListener('load', () => window.print());
                logo.addEventListener('error', () => window.print());
            } else {
                window.print();
            }
        }
    });
}

function showNoData() {
    console.log('[Clearance Form] Showing no data message');
    document.getElementById('clearanceTableBody').innerHTML = 
        '<tr><td colspan="5" style="text-align: center; color: #999; padding: 40px;">No data available. Please try clicking the clearance form button again.</td></tr>';
}

function setupButtons() {
    console.log('[Clearance Form] Setting up buttons');
    
    const printBtn = document.getElementById('printBtn');
    const closeBtn = document.getElementById('closeBtn');
    
    if (printBtn) {
        printBtn.addEventListener('click', function() {
            console.log('[Clearance Form] Print button clicked');
            window.print();
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            console.log('[Clearance Form] Close button clicked');
            window.close();
        });
    }
}

// Initialize when page loads
if (document.readyState === 'loading') {
    console.log('[Clearance Form] Waiting for DOM');
    document.addEventListener('DOMContentLoaded', function() {
        setupButtons();
        initializeClearanceForm();
    });
} else {
    console.log('[Clearance Form] DOM ready, initializing now');
    setupButtons();
    initializeClearanceForm();
}

function generateClearanceForm(data) {
    console.log('[Clearance Form] Generating form');
    
    if (!data.events || !data.events.d) {
        console.error('[Clearance Form] Invalid events data structure');
        showNoData();
        return;
    }
    
    const events = data.events.d;
    const studentInfo = data.studentInfo || {};
    const schoolInfo = data.schoolInfo || {};
    
    // Set student information
    document.getElementById('studentName').textContent = studentInfo.name || '-';
    document.getElementById('yearGroup').textContent = studentInfo.yearGroup || '-';
    document.getElementById('faction').textContent = studentInfo.faction || '-';
    
    // Set school name from intercepted Compass.schoolName
    if (schoolInfo.name) {
        document.getElementById('schoolName').textContent = schoolInfo.name;
    }
    
    // Set school logo from the school's Compass CDN URL
    const logoElement = document.getElementById('schoolLogo');
    if (schoolInfo.logoUrl) {
        logoElement.src = schoolInfo.logoUrl;
        logoElement.style.display = 'block';
        logoElement.onerror = () => { logoElement.style.display = 'none'; };
    }
    
    // Set current year and term
    const now = new Date();
    const currentYear = now.getFullYear();
    // Calculate term based on month (approximate)
    let currentTerm = 1;
    const month = now.getMonth() + 1; // 1-12
    if (month >= 1 && month <= 3) currentTerm = 1;
    else if (month >= 4 && month <= 6) currentTerm = 2;
    else if (month >= 7 && month <= 9) currentTerm = 3;
    else currentTerm = 4;
    
    document.getElementById('yearTerm').textContent = `Year: ${currentYear} | Term: ${currentTerm}`;
    
    // Extract unique subjects from events
    const subjectsMap = new Map();
    
    events.forEach(event => {
        // Skip events without subject information
        if (!event.title || !event.subjectLongName) return;
        
        const subjectCode = event.title;
        
        // If we haven't seen this subject code yet, add it
        if (!subjectsMap.has(subjectCode)) {
            // Get teacher name
            let teacherName = '';
            if (event.managers && event.managers[0] && event.managers[0].managerImportIdentifier) {
                teacherName = formatTeacherName(event.managers[0].managerImportIdentifier);
            }
            
            subjectsMap.set(subjectCode, {
                subjectName: event.subjectLongName,
                subjectCode: subjectCode,
                teacher: teacherName
            });
        }
    });
    
    // Convert to array and sort by subject name
    const subjects = Array.from(subjectsMap.values()).sort((a, b) => 
        a.subjectName.localeCompare(b.subjectName)
    );
    
    console.log('[Clearance Form] Found', subjects.length, 'unique subjects');
    
    // Generate table rows
    let tableHTML = '';
    
    // Add subject rows
    subjects.forEach(subject => {
        tableHTML += `
            <tr>
                <td>${subject.subjectName}</td>
                <td>${subject.subjectCode}</td>
                <td>${subject.teacher}</td>
                <td></td>
                <td class="signature-cell"></td>
            </tr>
        `;
    });
    
    // Add special rows
    tableHTML += `
        <tr class="special-row">
            <td>Library</td>
            <td></td>
            <td></td>
            <td></td>
            <td class="signature-cell"></td>
        </tr>
        <tr class="special-row">
            <td>Locker Return</td>
            <td></td>
            <td></td>
            <td></td>
            <td class="signature-cell"></td>
        </tr>
    `;
    
    document.getElementById('clearanceTableBody').innerHTML = tableHTML;
    
    console.log('[Clearance Form] Form generated successfully');
}

function formatTeacherName(name) {
    if (!name || name.length < 2) return name;
    // Extract first initial and last name (format: "jSmith" -> "J. Smith")
    const firstInitial = name.charAt(0).toUpperCase();
    const lastName = name.charAt(1).toUpperCase() + name.slice(2);
    return `${firstInitial}. ${lastName}`;
}