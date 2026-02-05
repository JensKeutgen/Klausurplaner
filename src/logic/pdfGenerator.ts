import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AppState, Week } from '../types';

// Helper to get formatted date from week + day
// Assumption: We need a way to map Week Number + Year + DayOfWeek to a specific Date string (DD.MM.)
// Since we don't have a calendar library, we'll approximate or assume the user inputs dates or we use a helper.
// For now, let's assume we can calculate it from proper ISO Block Weeks. 
// OR simpler: Just display "KWxx" if date is hard.
// User screenshot shows "DD.MM." AND "(KWxx)".
// To get DD.MM. we need the start date of the week.
// We can use a simple ISO week date calculator.

function getDateOfIsoWeek(week: number, year: number) {
    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const dayOfWeek = simple.getDay();
    const ISOweekStart = simple;
    if (dayOfWeek <= 4)
        ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    else
        ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    return ISOweekStart;
}

function getExamDateString(week: Week, dayIndex: number): string {
    // dayIndex: 0=Mon, 1=Tue...
    const startDate = getDateOfIsoWeek(week.weekNumber, week.year);
    // Add dayIndex days
    const examDate = new Date(startDate);
    examDate.setDate(startDate.getDate() + dayIndex);

    // Format DD.MM.
    const day = String(examDate.getDate()).padStart(2, '0');
    const month = String(examDate.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.`;
}

// Color Palette for Weeks (Simple rotation)
const WEEK_COLORS = [
    '#FCA5A5', // Red 300
    '#FDBA74', // Orange 300
    '#FDE047', // Yellow 300
    '#86EFAC', // Green 300
    '#93C5FD', // Blue 300
    '#C4B5FD', // Violet 300
    '#F9A8D4', // Pink 300
    '#E5E7EB', // Gray 200
];

function getWeekColor(weekNumber: number): string {
    // Map week number to index
    const index = weekNumber % WEEK_COLORS.length;
    return WEEK_COLORS[index];
}

const DAY_MAP: Record<string, number> = {
    'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4
};

export function generatePDF(state: AppState) {
    const doc = new jsPDF({ orientation: 'landscape' });

    // Title
    doc.setFontSize(18);
    doc.text(state.pdfSettings?.title || 'Klausurplanung 2025 - 1. Quartal', 14, 22);

    // Prepare Data
    // Columns: [ "Fach", ...Classes ]
    const classes = [...state.classes].sort((a, b) => a.className.localeCompare(b.className));
    const classNames = classes.map(c => c.className);

    // Rows: Unique Subjects
    const allSubjects = new Set<string>();
    state.exams.forEach(exam => allSubjects.add(exam.subject));
    const subjects = Array.from(allSubjects).sort();

    // Matrix Construction
    const head = [['Fach', ...classNames]];
    const body: any[][] = [];

    subjects.forEach(subject => {
        const row: any[] = [subject]; // First col is Subject Name

        classNames.forEach(className => {
            // Find exam for this Subject + Class
            const exam = state.exams.find(e => e.className === className && e.subject === subject);

            if (exam && exam.assignedWeekId && exam.assignedDay) {
                const week = state.weeks.find(w => w.id === exam.assignedWeekId);
                const weekNum = week ? week.weekNumber : '?';
                const dateStr = week ? getExamDateString(week, DAY_MAP[exam.assignedDay]) : '';

                // Cell Content
                // Format: "DD.MM.\n(KWxx)"
                const content = `${dateStr}\n(KW${weekNum})`;

                // Color
                const fillColor = week ? getWeekColor(week.weekNumber) : '#ffffff';

                // We need to pass custom styles for this cell. 
                // jspdf-autotable allows object content with styles.
                row.push({
                    content: content,
                    styles: {
                        fillColor: fillColor,
                        halign: 'center',
                        valign: 'middle'
                    }
                });
            } else {
                // Check if subject is even taught in this class?
                // If taught but no exam: "Keine Klausur"?
                // If NOT taught: Empty or "Nein"
                // The current logic assumes if it's in the schedule it's taught.
                // If no exam found -> "Keine Klausur" (if we want to be explicit) or just empty string.
                // Screenshot shows grey "Keine Klausur".

                // Simple check if subject is in class schedule
                const cls = state.classes.find(c => c.className === className);
                const isTaught = cls ? Object.values(cls.subjects).flat().includes(subject) : false;

                if (isTaught) {
                    row.push({
                        content: 'Keine\nKlausur',
                        styles: {
                            fillColor: [220, 220, 220], // Grey
                            textColor: [50, 50, 50],
                            halign: 'center',
                            valign: 'middle',
                            fontSize: 8
                        }
                    });
                } else {
                    row.push(''); // Not taught
                }
            }
        });
        body.push(row);
    });

    // Special Rows
    // Nachschreibetermin
    if (state.pdfSettings?.makeupExamInfo) {
        const rowNach = [
            { content: 'Nachschreibetermin', styles: { fontStyle: 'bold', halign: 'right' } },
            ...classNames.map(() => ({ content: state.pdfSettings.makeupExamInfo, styles: { halign: 'center' } }))
        ];
        body.push(rowNach);
    }

    // Quartalsnoten
    if (state.pdfSettings?.gradesDueDate) {
        const rowQuartal = [
            { content: 'Noten eintragen', styles: { fontStyle: 'bold', halign: 'right' } },
            ...classNames.map(() => ({ content: state.pdfSettings.gradesDueDate, styles: { halign: 'center' } }))
        ];
        body.push(rowQuartal);
    }

    // Generate Table
    autoTable(doc, {
        head: head,
        body: body,
        startY: 30,
        theme: 'grid',
        styles: {
            fontSize: 10,
            cellPadding: 3,
            lineColor: [0, 0, 0],
            lineWidth: 0.1,
            textColor: [0, 0, 0] // Black text
        },
        headStyles: {
            fillColor: [255, 255, 255], // White header
            textColor: [0, 0, 0], // Black text
            fontStyle: 'bold',
            lineWidth: 0.1,
            lineColor: [0, 0, 0] // Border
        },
        columnStyles: {
            0: { fontStyle: 'bold', halign: 'right', cellWidth: 30 } // Subject column
        },
        didParseCell: (_data: any) => {
            // Custom styling hooks if needed
        }
    });

    // Extra text footer
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(8);
    doc.text('*Absprache mit KuK', 14, finalY);
    doc.text('**individuell (gegeben falls gemeinsamer Termin nach den Ferien)', 14, finalY + 5);

    doc.save('klausurplan_uebersicht.pdf');
}
