import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { listAttendanceRegisters } from '../../services/attendanceService'
import { listLessonSessions } from '../../services/lessonControlService'
import { generateQuarterlyAttendanceReportPDF } from '../../services/pdfService'
import { calculateStudentAttendance, formatRegisterPeriod } from '../../utils/attendanceUtils'
import { canAccessAttendanceRegister } from '../../utils/accessControl'

const LESSON_END_GRACE_MINUTES = 5

function formatSessionTime(isoValue) {
  if (!isoValue) return '--:--'
  return new Date(isoValue).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSessionDate(dateKey) {
  if (!dateKey) return ''
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('pt-BR')
}

function formatCoordinate(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(5) : '--'
}

function formatLocationTimestamp(isoValue) {
  if (!isoValue) return '--'
  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildMapsUrl(point) {
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return ''
  return `https://www.google.com/maps?q=${Number(point.lat)},${Number(point.lng)}`
}

function buildScheduledDateTime(dateKey, timeValue) {
  if (!dateKey || !timeValue) return null
  const candidate = new Date(`${dateKey}T${timeValue}:00`)
  return Number.isNaN(candidate.getTime()) ? null : candidate
}

function getSessionOpenIso(session) {
  return session?.monitoringActivatedAt || session?.checkInAt || null
}

function getDeltaMinutes(actualIso, scheduledDate) {
  if (!actualIso || !scheduledDate) return null
  const actualDate = new Date(actualIso)
  if (Number.isNaN(actualDate.getTime())) return null
  return Math.round((actualDate.getTime() - scheduledDate.getTime()) / 60000)
}

function formatDeltaLabel(deltaMinutes, { emptyLabel = '--', onTimeLabel = 'No horário' } = {}) {
  if (!Number.isFinite(deltaMinutes)) return emptyLabel
  if (deltaMinutes === 0) return onTimeLabel
  if (deltaMinutes > 0) return `${deltaMinutes} min atrasado`
  return `${Math.abs(deltaMinutes)} min adiantado`
}

function average(values = []) {
  if (!values.length) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

function sumPositive(values = []) {
  return values.filter((value) => Number.isFinite(value) && value > 0).reduce((total, value) => total + value, 0)
}

function sumNegativeAbsolute(values = []) {
  return Math.abs(values.filter((value) => Number.isFinite(value) && value < 0).reduce((total, value) => total + value, 0))
}

function compareNames(a = '', b = '') {
  return String(a).localeCompare(String(b), 'pt-BR')
}

function buildQuarterKey(register) {
  const startDate = register?.startDate || ''
  const endDate = register?.endDate || ''
  if (startDate && endDate) return `${startDate}__${endDate}`

  const sundayDates = Array.isArray(register?.sundayDates) ? [...register.sundayDates].sort() : []
  if (sundayDates.length > 0) {
    return `${sundayDates[0]}__${sundayDates[sundayDates.length - 1]}`
  }

  const month = String(register?.month || '').padStart(2, '0')
  const year = String(register?.year || '')
  return `${year}-${month}`
}

function buildQuarterLabel(register) {
  return formatRegisterPeriod(register) || 'Período não identificado'
}

function getSortedSundayDates(register) {
  return [...new Set(Array.isArray(register?.sundayDates) ? register.sundayDates.filter(Boolean) : [])].sort()
}

function getRegisterStudentEntries(register) {
  const studentsMap = new Map()

  ;(Array.isArray(register?.students) ? register.students : []).forEach((student) => {
    if (!student?.id) return
    studentsMap.set(student.id, {
      id: student.id,
      fullName: student?.fullName || student?.name || '',
    })
  })

  ;(Array.isArray(register?.studentsSnapshot) ? register.studentsSnapshot : []).forEach((student) => {
    if (!student?.id) return
    if (!studentsMap.has(student.id)) {
      studentsMap.set(student.id, {
        id: student.id,
        fullName: student?.fullName || student?.name || '',
      })
    }
  })

  const ids = [
    ...(Array.isArray(register?.enrolledStudentIds) ? register.enrolledStudentIds : []),
    ...Object.keys(register?.attendanceByStudent || {}),
    ...Array.from(studentsMap.keys()),
  ].filter(Boolean)

  return [...new Set(ids)].map((studentId) => {
    const student = studentsMap.get(studentId)
    return {
      id: studentId,
      fullName: student?.fullName || student?.name || `Aluno ${String(studentId).slice(0, 6)}`,
    }
  })
}

function buildQuarterRegisterSummary(register) {
  const sundayDates = getSortedSundayDates(register)
  const students = getRegisterStudentEntries(register)
  const studentRows = students.map((student) => {
    const attendance = calculateStudentAttendance(sundayDates, register?.attendanceByStudent?.[student.id] || {})
    return {
      studentId: student.id,
      studentName: student.fullName,
      classId: register?.classId || '',
      className: register?.className || 'Classe não informada',
      teacherName: register?.teacherName || 'Professor não informado',
      totalPP: attendance.totalPP,
      totalP: attendance.totalP,
      totalA: attendance.totalA,
      totalPresences: attendance.totalPP + attendance.totalP,
      totalRecorded: attendance.totalPP + attendance.totalP + attendance.totalA,
      attendanceRate: attendance.percentualFinal,
    }
  })

  const totalPP = studentRows.reduce((total, row) => total + row.totalPP, 0)
  const totalP = studentRows.reduce((total, row) => total + row.totalP, 0)
  const totalA = studentRows.reduce((total, row) => total + row.totalA, 0)
  const totalRecorded = totalPP + totalP + totalA

  return {
    registerId: register?.id || '',
    classId: register?.classId || '',
    className: register?.className || 'Classe não informada',
    teacherName: register?.teacherName || 'Professor não informado',
    periodLabel: buildQuarterLabel(register),
    sundayCount: sundayDates.length,
    studentCount: students.length,
    totalPP,
    totalP,
    totalA,
    totalPresences: totalPP + totalP,
    totalRecorded,
    attendanceRate: totalRecorded ? ((totalPP + totalP) / totalRecorded) * 100 : 0,
    studentRows,
  }
}

function getSessionTiming(session) {
  const scheduledStart = buildScheduledDateTime(session?.lessonDateKey, session?.lessonStartTime)
  const scheduledEnd = buildScheduledDateTime(session?.lessonDateKey, session?.lessonEndTime)
  const openDeltaMinutes = getDeltaMinutes(getSessionOpenIso(session), scheduledStart)
  const closeDeltaMinutes = getDeltaMinutes(session?.endedAt, scheduledEnd)

  return {
    openDeltaMinutes,
    closeDeltaMinutes,
    hasOpenTiming: Number.isFinite(openDeltaMinutes),
    hasCloseTiming: Number.isFinite(closeDeltaMinutes),
    openedOnTime: Number.isFinite(openDeltaMinutes) ? openDeltaMinutes <= 0 : false,
    closedOnTime: Number.isFinite(closeDeltaMinutes) ? closeDeltaMinutes <= LESSON_END_GRACE_MINUTES : false,
  }
}

export default function ReportsPage() {
  const { user, profile, canManageStructure } = useAuth()
  const [sessions, setSessions] = useState([])
  const [attendanceRegisters, setAttendanceRegisters] = useState([])
  const [selectedQuarterKey, setSelectedQuarterKey] = useState('')
  const [isExportingQuarterPdf, setIsExportingQuarterPdf] = useState(false)

  useEffect(() => {
    if (!user?.uid) return

    async function load() {
      const [lessonSessions, registers] = await Promise.all([
        listLessonSessions(user.uid, {
          includeAll: canManageStructure,
        }).catch(() => []),
        listAttendanceRegisters(user.uid).catch(() => []),
      ])

      const visibleRegisters = canManageStructure
        ? registers
        : registers.filter((item) => canAccessAttendanceRegister(item, user, profile))

      setSessions(lessonSessions)
      setAttendanceRegisters(visibleRegisters)
    }

    load()
  }, [canManageStructure, profile, user, user?.uid])

  const summary = useMemo(() => {
    const totalSessions = sessions.length
    const confirmedPresence = sessions.filter((session) => session?.presenceConfirmed).length
    const punctualSessions = sessions.filter((session) => session?.punctualityOk).length
    const extrapolatedSessions = sessions.filter((session) => session?.finishStatus === 'extrapolated').length
    const finalizedSessions = sessions.filter((session) => !!session?.endedAt).length
    const sessionTimings = sessions.map((session) => getSessionTiming(session))
    const openingRows = sessionTimings.filter((item) => item.hasOpenTiming)
    const closingRows = sessionTimings.filter((item) => item.hasCloseTiming)
    const openingOnTimeCount = openingRows.filter((item) => item.openedOnTime).length
    const closingOnTimeCount = closingRows.filter((item) => item.closedOnTime).length
    const averageOpenDeltaMinutes = average(openingRows.map((item) => item.openDeltaMinutes))
    const averageCloseDeltaMinutes = average(closingRows.map((item) => item.closeDeltaMinutes))

    return {
      totalSessions,
      confirmedPresence,
      punctualSessions,
      extrapolatedSessions,
      finalizedSessions,
      openingRowsCount: openingRows.length,
      closingRowsCount: closingRows.length,
      openingOnTimeCount,
      closingOnTimeCount,
      averageOpenDeltaMinutes,
      averageCloseDeltaMinutes,
    }
  }, [sessions])

  const sundayChartData = useMemo(() => {
    const grouped = sessions.reduce((acc, session) => {
      const dateKey = session?.lessonDateKey || 'sem-data'
      if (!acc[dateKey]) {
        acc[dateKey] = {
          dateKey,
          label: formatSessionDate(dateKey),
          pontuais: 0,
          extrapoladas: 0,
        }
      }

      if (session?.punctualityOk) acc[dateKey].pontuais += 1
      if (session?.finishStatus === 'extrapolated') acc[dateKey].extrapoladas += 1

      return acc
    }, {})

    return Object.values(grouped)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .slice(-8)
  }, [sessions])

  const teacherRows = useMemo(() => {
    const grouped = sessions.reduce((acc, session) => {
      const teacherKey = session?.teacherUid || session?.teacherEmail || session?.teacherName || 'sem-professor'
      const timing = getSessionTiming(session)
      if (!acc[teacherKey]) {
        acc[teacherKey] = {
          teacherName: session?.teacherName || 'Professor não identificado',
          total: 0,
          pontuais: 0,
          extrapoladas: 0,
          openTimings: [],
          closeTimings: [],
          openOnTimeCount: 0,
          closeOnTimeCount: 0,
        }
      }

      acc[teacherKey].total += 1
      if (session?.punctualityOk) acc[teacherKey].pontuais += 1
      if (session?.finishStatus === 'extrapolated') acc[teacherKey].extrapoladas += 1
      if (timing.hasOpenTiming) {
        acc[teacherKey].openTimings.push(timing.openDeltaMinutes)
        if (timing.openedOnTime) acc[teacherKey].openOnTimeCount += 1
      }
      if (timing.hasCloseTiming) {
        acc[teacherKey].closeTimings.push(timing.closeDeltaMinutes)
        if (timing.closedOnTime) acc[teacherKey].closeOnTimeCount += 1
      }

      return acc
    }, {})

    return Object.values(grouped)
      .map((item) => ({
        ...item,
        taxaPontualidade: item.total ? (item.pontuais / item.total) * 100 : 0,
        averageOpenDeltaMinutes: average(item.openTimings),
        averageCloseDeltaMinutes: average(item.closeTimings),
      }))
      .sort((a, b) => b.total - a.total)
  }, [sessions])

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => String(b.lessonDateKey || '').localeCompare(String(a.lessonDateKey || ''))),
    [sessions],
  )

  const monthlyTeacherRows = useMemo(() => {
    const grouped = sessions.reduce((acc, session) => {
      const monthKey = String(session?.lessonDateKey || '').slice(0, 7) || 'sem-mes'
      const teacherKey = session?.teacherUid || session?.teacherEmail || session?.teacherName || 'sem-professor'
      const entryKey = `${monthKey}:${teacherKey}`
      const timing = getSessionTiming(session)

      if (!acc[entryKey]) {
        acc[entryKey] = {
          monthKey,
          teacherName: session?.teacherName || 'Professor não identificado',
          totalSessions: 0,
          openTimings: [],
          closeTimings: [],
        }
      }

      acc[entryKey].totalSessions += 1
      if (timing.hasOpenTiming) acc[entryKey].openTimings.push(timing.openDeltaMinutes)
      if (timing.hasCloseTiming) acc[entryKey].closeTimings.push(timing.closeDeltaMinutes)
      return acc
    }, {})

    return Object.values(grouped)
      .map((item) => ({
        ...item,
        openLateMinutes: sumPositive(item.openTimings),
        openEarlyMinutes: sumNegativeAbsolute(item.openTimings),
        closeLateMinutes: sumPositive(item.closeTimings),
        closeEarlyMinutes: sumNegativeAbsolute(item.closeTimings),
      }))
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey) || a.teacherName.localeCompare(b.teacherName))
  }, [sessions])

  const quarterOptions = useMemo(() => {
    const grouped = attendanceRegisters.reduce((acc, register) => {
      const quarterKey = buildQuarterKey(register)
      if (!quarterKey) return acc

      if (!acc[quarterKey]) {
        acc[quarterKey] = {
          value: quarterKey,
          label: buildQuarterLabel(register),
          sortKey: register?.startDate || getSortedSundayDates(register)[0] || `${register?.year || ''}-${String(register?.month || '').padStart(2, '0')}`,
        }
      }

      return acc
    }, {})

    return Object.values(grouped).sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)))
  }, [attendanceRegisters])

  useEffect(() => {
    if (!quarterOptions.length) {
      setSelectedQuarterKey('')
      return
    }

    if (!selectedQuarterKey || !quarterOptions.some((option) => option.value === selectedQuarterKey)) {
      setSelectedQuarterKey(quarterOptions[0].value)
    }
  }, [quarterOptions, selectedQuarterKey])

  const quarterRegisterRows = useMemo(() => {
    if (!selectedQuarterKey) return []

    return attendanceRegisters
      .filter((register) => buildQuarterKey(register) === selectedQuarterKey)
      .map(buildQuarterRegisterSummary)
      .sort((a, b) => (
        b.attendanceRate - a.attendanceRate
        || compareNames(a.className, b.className)
      ))
  }, [attendanceRegisters, selectedQuarterKey])

  const quarterSummary = useMemo(() => {
    const totalClasses = quarterRegisterRows.length
    const totalStudents = quarterRegisterRows.reduce((total, row) => total + row.studentCount, 0)
    const totalSundays = quarterRegisterRows.reduce((total, row) => total + row.sundayCount, 0)
    const totalPP = quarterRegisterRows.reduce((total, row) => total + row.totalPP, 0)
    const totalP = quarterRegisterRows.reduce((total, row) => total + row.totalP, 0)
    const totalA = quarterRegisterRows.reduce((total, row) => total + row.totalA, 0)
    const totalRecorded = quarterRegisterRows.reduce((total, row) => total + row.totalRecorded, 0)
    const totalPresences = totalPP + totalP

    return {
      totalClasses,
      totalStudents,
      totalSundays,
      totalPP,
      totalP,
      totalA,
      totalRecorded,
      totalPresences,
      attendanceRate: totalRecorded ? (totalPresences / totalRecorded) * 100 : 0,
    }
  }, [quarterRegisterRows])

  const quarterStudentRows = useMemo(
    () => quarterRegisterRows
      .flatMap((row) => row.studentRows)
      .sort((a, b) => (
        b.attendanceRate - a.attendanceRate
        || compareNames(a.studentName, b.studentName)
        || compareNames(a.className, b.className)
      )),
    [quarterRegisterRows],
  )

  async function handleExportQuarterPdf() {
    if (!quarterRegisterRows.length || isExportingQuarterPdf) return

    setIsExportingQuarterPdf(true)
    try {
      const selectedQuarterLabel = quarterOptions.find((option) => option.value === selectedQuarterKey)?.label || 'Trimestre'
      await generateQuarterlyAttendanceReportPDF({
        quarterLabel: selectedQuarterLabel,
        generatedAtLabel: new Date().toLocaleString('pt-BR'),
        summary: quarterSummary,
        registerRows: quarterRegisterRows,
        studentRows: quarterStudentRows,
      })
    } finally {
      setIsExportingQuarterPdf(false)
    }
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Relatórios</h2>
          <p className="feature-subtitle">
            {canManageStructure
              ? 'Painel consolidado de pontualidade, check-in e extrapolação das aulas.'
              : 'Histórico pessoal de pontualidade, check-in e encerramento das suas aulas.'}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Relatório trimestral de presenças"
          subtitle={canManageStructure
            ? 'Consolidação por trimestre das cadernetas, classes e alunos.'
            : 'Consolidação trimestral das suas classes e alunos vinculados.'}
          action={(
            <Button
              variant="secondary"
              onClick={handleExportQuarterPdf}
              loading={isExportingQuarterPdf}
              disabled={!quarterRegisterRows.length}
            >
              Exportar PDF do trimestre
            </Button>
          )}
        />

        <div className="inline-form">
          <label htmlFor="reports-quarter-filter">Trimestre consolidado</label>
          <select
            id="reports-quarter-filter"
            value={selectedQuarterKey}
            onChange={(event) => setSelectedQuarterKey(event.target.value)}
          >
            {quarterOptions.length === 0 && <option value="">Nenhum trimestre disponível</option>}
            {quarterOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        {quarterRegisterRows.length > 0 ? (
          <>
            <div className="summary-grid">
              <div className="summary-item">
                <span className="summary-label">Classes</span>
                <span className="summary-value">{quarterSummary.totalClasses}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Alunos matriculados</span>
                <span className="summary-value">{quarterSummary.totalStudents}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Domingos somados</span>
                <span className="summary-value">{quarterSummary.totalSundays}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Presenças (PP + P)</span>
                <span className="summary-value">{quarterSummary.totalPresences}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Ausências</span>
                <span className="summary-value">{quarterSummary.totalA}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">PP</span>
                <span className="summary-value">{quarterSummary.totalPP}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Aproveitamento geral</span>
                <span className="summary-value">{quarterSummary.attendanceRate.toFixed(1)}%</span>
              </div>
            </div>

            <div className="entity-list" style={{ marginTop: 16 }}>
              {quarterRegisterRows.map((row) => (
                <div key={row.registerId} className="entity-row">
                  <div>
                    <div className="entity-title">{row.className}</div>
                    <div className="entity-meta">
                      {row.periodLabel} • {row.teacherName}
                    </div>
                    <div className="entity-meta">
                      matriculados: {row.studentCount} • domingos: {row.sundayCount} • presenças: {row.totalPresences} • ausências: {row.totalA}
                    </div>
                    <div className="entity-meta">
                      PP: {row.totalPP} • P: {row.totalP} • aproveitamento: {row.attendanceRate.toFixed(1)}%
                    </div>
                  </div>
                  <span className={`entity-status ${row.attendanceRate < 75 ? 'inactive' : 'active'}`}>
                    {row.attendanceRate.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="feature-subtitle">Nenhuma caderneta trimestral encontrada para o período selecionado.</p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Alunos no trimestre"
          subtitle="Lista consolidada por aluno, ordenada pelo maior percentual de presença."
        />
        <div className="entity-list">
          {quarterStudentRows.length === 0 && <p className="feature-subtitle">Nenhum aluno consolidado para este trimestre.</p>}
          {quarterStudentRows.map((student) => (
            <div key={`${student.classId}-${student.studentId}`} className="entity-row">
              <div>
                <div className="entity-title">{student.studentName}</div>
                <div className="entity-meta">
                  {student.className} • {student.teacherName}
                </div>
                <div className="entity-meta">
                  Presenças: {student.totalPresences} • Ausências: {student.totalA} • PP: {student.totalPP} • P: {student.totalP}
                </div>
              </div>
              <span className={`entity-status ${student.attendanceRate < 75 ? 'inactive' : 'active'}`}>
                {student.attendanceRate.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Resumo da aula"
          subtitle="Indicadores consolidados das sessões registradas pelo painel de controle."
        />
        <div className="summary-grid">
          <div className="summary-item">
            <span className="summary-label">Aulas registradas</span>
            <span className="summary-value">{summary.totalSessions}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Check-ins confirmados</span>
            <span className="summary-value">{summary.confirmedPresence}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Pontualidade OK</span>
            <span className="summary-value">{summary.punctualSessions}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Aulas extrapoladas</span>
            <span className="summary-value">{summary.extrapolatedSessions}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Aberturas no horário</span>
            <span className="summary-value">{summary.openingRowsCount ? `${summary.openingOnTimeCount}/${summary.openingRowsCount}` : '--'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Fechamentos no prazo</span>
            <span className="summary-value">{summary.closingRowsCount ? `${summary.closingOnTimeCount}/${summary.closingRowsCount}` : '--'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Média de abertura</span>
            <span className="summary-value">{formatDeltaLabel(summary.averageOpenDeltaMinutes, { emptyLabel: '--', onTimeLabel: 'No horário' })}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Média de fechamento</span>
            <span className="summary-value">{formatDeltaLabel(summary.averageCloseDeltaMinutes, { emptyLabel: '--', onTimeLabel: 'No horário' })}</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Curva de extrapolação por domingo"
          subtitle="Comparativo entre aulas pontuais e extrapoladas nas últimas 8 datas registradas."
        />
        {sundayChartData.length > 0 ? (
          <div className="dashboard-frequency-chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={sundayChartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="pontuais" name="Pontuais" fill="#15803d" radius={[4, 4, 0, 0]} />
                <Bar dataKey="extrapoladas" name="Extrapoladas" fill="#b91c1c" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="feature-subtitle">Ainda não há sessões suficientes para montar o gráfico.</p>
        )}
      </Card>

      {canManageStructure && (
        <Card>
          <CardHeader
            title="Comparativo por professor"
            subtitle="Ajuda a superintendência a identificar quem está mantendo o horário e quem precisa de acompanhamento."
          />
          <div className="entity-list">
            {teacherRows.length === 0 && <p className="feature-subtitle">Nenhum professor com sessões registradas ainda.</p>}
            {teacherRows.map((teacher) => (
              <div key={teacher.teacherName} className="entity-row">
                <div>
                  <div className="entity-title">{teacher.teacherName}</div>
                  <div className="entity-meta">
                    {teacher.total} aula(s) • {teacher.pontuais} pontual(is) • {teacher.extrapoladas} extrapolada(s)
                  </div>
                  <div className="entity-meta">
                    Abertura média: {formatDeltaLabel(teacher.averageOpenDeltaMinutes, { emptyLabel: 'sem dado', onTimeLabel: 'no horário' })} • Fechamento médio: {formatDeltaLabel(teacher.averageCloseDeltaMinutes, { emptyLabel: 'sem dado', onTimeLabel: 'no horário' })}
                  </div>
                </div>
                <span className={`entity-status ${teacher.extrapoladas > 0 ? 'inactive' : 'active'}`}>
                  {teacher.openTimings.length ? `${Math.round((teacher.openOnTimeCount / teacher.openTimings.length) * 100)}% na abertura` : `${teacher.taxaPontualidade.toFixed(0)}% pontual`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Fechamento mensal de pontualidade"
          subtitle="Soma de minutos adiantados e atrasados por professor ao longo do mes."
        />
        <div className="entity-list">
          {monthlyTeacherRows.length === 0 && <p className="feature-subtitle">Nenhum dado mensal disponivel ainda.</p>}
          {monthlyTeacherRows.map((item) => (
            <div key={`${item.monthKey}-${item.teacherName}`} className="entity-row">
              <div>
                <div className="entity-title">
                  {item.teacherName} • {item.monthKey}
                </div>
                <div className="entity-meta">
                  {item.totalSessions} aula(s) • abertura atrasada: {item.openLateMinutes} min • abertura adiantada: {item.openEarlyMinutes} min
                </div>
                <div className="entity-meta">
                  fechamento atrasado: {item.closeLateMinutes} min • fechamento adiantado: {item.closeEarlyMinutes} min
                </div>
              </div>
              <span className={`entity-status ${item.openLateMinutes > 0 || item.closeLateMinutes > 0 ? 'inactive' : 'active'}`}>
                {item.openLateMinutes + item.closeLateMinutes} min de atraso
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Últimos registros"
          subtitle="Linha do tempo dos fechamentos de aula para auditoria rápida."
        />
        <div className="entity-list">
          {orderedSessions.length === 0 && <p className="feature-subtitle">Nenhum registro de aula encontrado.</p>}
          {orderedSessions.map((session) => {
            const timing = getSessionTiming(session)
            const sessionMapUrl = buildMapsUrl(session?.geoPoint)
            return (
              <div key={`${session.storageOwnerUid || 'uid'}-${session.id}`} className="entity-row">
                <div>
                  <div className="entity-title">
                    {canManageStructure ? session.teacherName || 'Professor não identificado' : formatSessionDate(session.lessonDateKey)}
                  </div>
                  <div className="entity-meta">
                    {canManageStructure ? formatSessionDate(session.lessonDateKey) : 'Sua aula'} • Abertura: {formatSessionTime(getSessionOpenIso(session))} ({formatDeltaLabel(timing.openDeltaMinutes, { emptyLabel: 'sem dado', onTimeLabel: 'no horário' })})
                  </div>
                  <div className="entity-meta">
                    Check-in: {session.presenceConfirmed ? 'Confirmado' : 'Pendente'} • Término: {formatSessionTime(session.endedAt)} ({formatDeltaLabel(timing.closeDeltaMinutes, { emptyLabel: 'sem dado', onTimeLabel: 'no horário' })})
                  </div>
                  <div className="entity-meta">
                    GPS: {session.locationCheckedAt ? formatLocationTimestamp(session.locationCheckedAt) : 'sem leitura'} • Distância: {Number.isFinite(Number(session.distanceMeters)) ? `${Math.round(Number(session.distanceMeters))} m` : '--'} • Coordenadas: {session?.geoPoint ? `${formatCoordinate(session.geoPoint.lat)}, ${formatCoordinate(session.geoPoint.lng)}` : '--'}
                  </div>
                  {sessionMapUrl && (
                    <div className="entity-meta">
                      <a href={sessionMapUrl} target="_blank" rel="noreferrer">Abrir ponto no mapa</a>
                    </div>
                  )}
                </div>
                <span className={`entity-status ${session.finishStatus === 'extrapolated' ? 'inactive' : 'active'}`}>
                  {timing.openedOnTime ? 'Abertura OK' : Number.isFinite(timing.openDeltaMinutes) ? 'Abertura tardia' : 'Sem abertura'}
                </span>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
