import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  calculateClassSummary,
  calculateStudentAttendance,
  formatMonthYear,
  formatSundayLabel,
} from '../utils/attendanceUtils'

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function imageToDataUrl(image) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function addReportHeader(doc, title, subtitle = '', logo = null) {
  const titleColor = [22, 78, 99]

  doc.setFillColor(...titleColor)
  doc.rect(0, 0, 210, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('Superintendencia EBD', 14, 11)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(title, 14, 18)

  if (subtitle) {
    doc.setFontSize(9)
    doc.text(subtitle, 14, 24)
  }

  if (logo) {
    const logoDataUrl = imageToDataUrl(logo)
    doc.addImage(logoDataUrl, 'PNG', 175, 5, 24, 18)
  }

  doc.setTextColor(0, 0, 0)
  return titleColor
}

function addReportFooter(doc) {
  const pages = doc.internal.getNumberOfPages()
  for (let index = 1; index <= pages; index += 1) {
    doc.setPage(index)
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    doc.text(`Superintendencia EBD - Pagina ${index} de ${pages}`, 105, 289, { align: 'center' })
  }
}

function sanitizeFileName(value = 'relatorio') {
  return String(value || 'relatorio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

export async function generateAttendanceNotebookPDF({ register, students }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const logo = await loadImage('/logo.png')

  const titleColor = addReportHeader(doc, 'Caderneta Trimestral de Frequencia', '', logo)
  const sundayDates = register?.sundayDates || []
  const attendanceByStudent = register?.attendanceByStudent || {}

  doc.setTextColor(0, 0, 0)
  doc.setFontSize(10)
  doc.text(`Professor: ${register.teacherName || 'Nao informado'}`, 14, 36)
  doc.text(`Classe: ${register.className || 'Nao informada'}`, 14, 42)
  doc.text(`Disciplina: ${register.discipline || 'Nao informada'}`, 14, 48)
  doc.text(`Competencia: ${formatMonthYear(register.month, register.year)}`, 14, 54)

  const body = students.map((student) => {
    const data = calculateStudentAttendance(sundayDates, attendanceByStudent[student.id])
    const marks = sundayDates.map((date) => attendanceByStudent[student.id]?.[date] || '')

    return [
      student.fullName,
      ...marks,
      data.totalPP,
      data.totalP,
      data.totalA,
      `${data.percentualFinal.toFixed(1)}%`,
    ]
  })

  autoTable(doc, {
    startY: 60,
    head: [[
      'Aluno',
      ...sundayDates.map(formatSundayLabel),
      'PP',
      'P',
      'A',
      '%',
    ]],
    body,
    headStyles: {
      fillColor: titleColor,
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 8,
    },
    margin: { left: 10, right: 10 },
    styles: { cellPadding: 1.6 },
    didParseCell(hook) {
      if (hook.section !== 'body') return
      if (hook.column.index > 0 && hook.column.index <= sundayDates.length) {
        if (hook.cell.raw === 'PP') hook.cell.styles.fillColor = [220, 252, 231]
        if (hook.cell.raw === 'P') hook.cell.styles.fillColor = [254, 243, 199]
        if (hook.cell.raw === 'A') hook.cell.styles.fillColor = [254, 226, 226]
      }
    },
  })

  const summary = calculateClassSummary(register, students)
  const summaryStart = doc.lastAutoTable.finalY + 8

  autoTable(doc, {
    startY: summaryStart,
    head: [['Resumo da Turma', 'Valor']],
    body: [
      ['Total de matriculados', summary.totalMatriculados],
      ['Total geral de PP', summary.totalGeralPP],
      ['Total geral de P', summary.totalGeralP],
      ['Total geral de A', summary.totalGeralA],
      ['Total de presencas (PP + P)', summary.totalPresencas],
      ['Total de ausencias', summary.totalAusencias],
      ['Media geral da turma', `${summary.mediaGeralTurma.toFixed(1)}%`],
    ],
    headStyles: { fillColor: [14, 116, 144] },
    bodyStyles: { fontSize: 9 },
    margin: { left: 10, right: 10 },
  })

  addReportFooter(doc)

  const fileName = `caderneta-${register.year}-${String(register.month).padStart(2, '0')}-${sanitizeFileName(register.className || 'classe')}.pdf`
  doc.save(fileName)
}

export async function generateQuarterlyAttendanceReportPDF({
  quarterLabel = 'Trimestre',
  generatedAtLabel = '',
  summary = {},
  registerRows = [],
  studentRows = [],
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const logo = await loadImage('/logo.png')
  const titleColor = addReportHeader(doc, 'Relatorio trimestral consolidado de presencas', quarterLabel, logo)

  doc.setFontSize(10)
  doc.text(`Periodo: ${quarterLabel || 'Nao informado'}`, 14, 36)
  doc.text(`Gerado em: ${generatedAtLabel || new Date().toLocaleString('pt-BR')}`, 14, 42)

  autoTable(doc, {
    startY: 50,
    head: [['Resumo geral', 'Valor']],
    body: [
      ['Turmas', summary.totalClasses ?? 0],
      ['Alunos lancados', summary.totalStudents ?? 0],
      ['Alunos unicos', summary.uniqueStudents ?? 0],
      ['Domingos somados', summary.totalSundays ?? 0],
      ['Presencas (PP + P)', summary.totalPresences ?? 0],
      ['Ausencias', summary.totalA ?? 0],
      ['PP', summary.totalPP ?? 0],
      ['P', summary.totalP ?? 0],
      ['Aproveitamento geral', `${Number(summary.attendanceRate || 0).toFixed(1)}%`],
    ],
    headStyles: { fillColor: titleColor },
    bodyStyles: { fontSize: 9 },
    margin: { left: 10, right: 10 },
  })

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [['Turma', 'Professor', 'Alunos', 'Domingos', 'Presencas', 'Ausencias', 'PP', 'P', '%']],
    body: registerRows.map((row) => ([
      row.className || 'Classe',
      row.teacherName || 'Professor',
      row.studentCount ?? 0,
      row.sundayCount ?? 0,
      row.totalPresences ?? 0,
      row.totalA ?? 0,
      row.totalPP ?? 0,
      row.totalP ?? 0,
      `${Number(row.attendanceRate || 0).toFixed(1)}%`,
    ])),
    headStyles: { fillColor: [14, 116, 144], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    margin: { left: 10, right: 10 },
  })

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [['Aluno', 'Turma', 'Professor', 'Presencas', 'Ausencias', 'PP', 'P', '%']],
    body: studentRows.map((row) => ([
      row.studentName || 'Aluno',
      row.className || 'Classe',
      row.teacherName || 'Professor',
      row.totalPresences ?? 0,
      row.totalA ?? 0,
      row.totalPP ?? 0,
      row.totalP ?? 0,
      `${Number(row.attendanceRate || 0).toFixed(1)}%`,
    ])),
    headStyles: { fillColor: [8, 145, 178], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    margin: { left: 10, right: 10 },
  })

  addReportFooter(doc)

  const fileName = `relatorio-trimestral-${sanitizeFileName(quarterLabel || 'trimestre')}.pdf`
  doc.save(fileName)
}
