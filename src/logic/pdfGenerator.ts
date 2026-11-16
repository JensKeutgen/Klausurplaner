import jsPDF from 'jspdf';
import autoTable, { type CellInput, type RowInput } from 'jspdf-autotable';
import type { AppState } from '../types';
import { formatShortDate, getWeekDayDate } from './dateUtils';

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
    const index = weekNumber % WEEK_COLORS.length;
    return WEEK_COLORS[index];
}

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
    const head: RowInput[] = [['Fach', ...classNames]];
    const body: RowInput[] = [];

    subjects.forEach(subject => {
        const row: CellInput[] = [subject]; // First col is Subject Name

        classNames.forEach(className => {
            // Find exam for this Subject + Class
            const exam = state.exams.find(e => e.className === className && e.subject === subject);

            if (exam && exam.assignedWeekId && exam.assignedDay) {
                const week = state.weeks.find(w => w.id === exam.assignedWeekId);
                const weekNum = week ? week.weekNumber : '?';
                const dateStr = week ? formatShortDate(getWeekDayDate(week, exam.assignedDay)) : '';

                // Cell Content
                // Format: "DD.MM.\n(KWxx)"
                const content = `${dateStr}\n(KW${weekNum})`;

                // Color
                const fillColor = week ? getWeekColor(week.weekNumber) : '#ffffff';

                row.push({
                    content: content,
                    styles: {
                        fillColor: fillColor,
                        halign: 'center',
                        valign: 'middle'
                    }
                });
            } else {
                const cls = state.classes.find(c => c.className === className);
                const isTaught = cls
                    ? Object.values(cls.subjects).flat().includes(subject) ||
                      (cls.subjectsB ? Object.values(cls.subjectsB).flat().includes(subject) : false)
                    : false;

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
        const rowNach: CellInput[] = [
            { content: 'Nachschreibetermin', styles: { fontStyle: 'bold', halign: 'right' } },
            ...classNames.map(() => ({ content: state.pdfSettings.makeupExamInfo, styles: { halign: 'center' as const } }))
        ];
        body.push(rowNach);
    }

    // Quartalsnoten
    if (state.pdfSettings?.gradesDueDate) {
        const rowQuartal: CellInput[] = [
            { content: 'Noten eintragen', styles: { fontStyle: 'bold', halign: 'right' } },
            ...classNames.map(() => ({ content: state.pdfSettings.gradesDueDate, styles: { halign: 'center' as const } }))
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
    });

    // Extra text footer
    const docWithTable = doc as jsPDF & { lastAutoTable?: { finalY: number } };
    const finalY = (docWithTable.lastAutoTable?.finalY ?? 150) + 10;
    doc.setFontSize(8);
    doc.text('*Absprache mit KuK', 14, finalY);
    doc.text('**individuell (gegeben falls gemeinsamer Termin nach den Ferien)', 14, finalY + 5);

    doc.save('klausurplan_uebersicht.pdf');
}
