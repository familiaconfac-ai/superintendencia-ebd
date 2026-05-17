import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bar,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Button from '../../components/ui/Button'
import Card, { SummaryCard } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { useLessonControl } from '../../context/LessonControlContext'
import { listAttendanceRegisters } from '../../services/attendanceService'
import { listEnrollments } from '../../services/enrollmentService'
import { listPeople } from '../../services/peopleService'
import { canAccessAttendanceRegister } from '../../utils/accessControl'
import { calculateDashboardOverview } from '../../utils/dashboardMetrics'

function getRegisterOwnerUid(register, fallbackUid = '') {
  return register?.storageOwnerUid || register?.ownerUid || register?.createdByUid || fallbackUid || ''
}

function getRegisterStudentIds(register) {
  const students = Array.isArray(register?.students) ? register.students : []
  const studentsSnapshot = Array.isArray(register?.studentsSnapshot) ? register.studentsSnapshot : []
  const enrolledStudentIds = Array.isArray(register?.enrolledStudentIds) ? register.enrolledStudentIds : []
  const attendanceStudentIds = Object.keys(register?.attendanceByStudent || {})

  return [
    ...students.map((item) => item?.id).filter(Boolean),
    ...studentsSnapshot.map((item) => item?.id).filter(Boolean),
    ...enrolledStudentIds.filter(Boolean),
    ...attendanceStudentIds.filter(Boolean),
  ]
}

function mergeById(list = []) {
  const map = new Map()
  list.forEach((item) => {
    if (!item?.id || map.has(item.id)) return
    map.set(item.id, item)
  })
  return Array.from(map.values())
}

function DashboardTimerCard({ countdown, onOpenPanel, onEditSchedule, canManageStructure }) {
  const isActiveWindow = countdown.isLessonWindow || countdown.isExpired
  const isCritical = countdown.isWarning || countdown.isExpired

  return (
    <Card className={`dashboard-timer-card${countdown.isWarning ? ' warning' : ''}${countdown.isExpired ? ' expired' : ''}`}>
      <div className="card-header">
        {canManageStructure ? (
          <div>
            <h3 className="card-title">Cronômetro inteligente da aula</h3>
            <p className="card-subtitle">
              Próxima aula: {countdown.lessonWeekdayLabel}, {countdown.lessonDateLabel}, às {countdown.lessonStartTimeLabel}.
            </p>
          </div>
        ) : (
          <div />
        )}
        <div className="lesson-panel-actions">
          <Button variant="secondary" size="sm" onClick={onOpenPanel}>
            {canManageStructure ? 'Abrir Painel' : 'Abrir cronômetro'}
          </Button>
          {canManageStructure && (
            <Button variant="secondary" size="sm" onClick={onEditSchedule}>
              Editar horário da aula
            </Button>
          )}
        </div>
      </div>

      {isActiveWindow ? (
        <div className={`dashboard-timer-grid${isCritical ? ' critical' : ''}`}>
          <div>
            <span>Início</span>
            <strong>{countdown.lessonStartTimeLabel}</strong>
          </div>
          <div>
            <span>Contagem regressiva</span>
            <strong>{countdown.isExpired ? '00:00:00' : countdown.countdownLabel}</strong>
          </div>
          <div>
            <span>Término</span>
            <strong>{countdown.lessonEndTime}</strong>
          </div>
        </div>
      ) : (
        <div className="dashboard-timer-idle">
          <strong>{countdown.statusLabel}</strong>
          <span>
            Primeiro alerta às {countdown.lessonWarningTime} e segundo alerta às {countdown.lessonEndTime}.
          </span>
        </div>
      )}

      <div className="lesson-panel-grid">
        <div className="lesson-panel-stat">
          <span>Primeiro alerta</span>
          <strong>{countdown.lessonWarningTime}</strong>
        </div>
        <div className="lesson-panel-stat">
          <span>Segundo alerta</span>
          <strong>{countdown.lessonEndTime}</strong>
        </div>
      </div>

      {countdown.isWarning && (
        <div className="dashboard-timer-warning-banner">
          Faltam {countdown.warningLeadMinutes} min para o gongo!
        </div>
      )}

      {countdown.isExpired && (
        <div className="dashboard-timer-warning-banner">
          Tempo encerrado. Finalize a aula agora.
        </div>
      )}
    </Card>
  )
}

export default function DashboardPage() {
  const { user, profile, canManageStructure } = useAuth()
  const { timeline } = useLessonControl()
  const navigate = useNavigate()
  const [people, setPeople] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [attendanceRegisters, setAttendanceRegisters] = useState([])

  useEffect(() => {
    if (!user?.uid) return

    async function load() {
      const registerList = await listAttendanceRegisters(user.uid)
      const visibleRegisters = canManageStructure
        ? registerList
        : registerList.filter((item) => canAccessAttendanceRegister(item, user, profile))

      const ownerUids = canManageStructure
        ? [user.uid]
        : [...new Set(
            visibleRegisters
              .map((item) => getRegisterOwnerUid(item, user.uid))
              .filter(Boolean),
          )]

      const [peopleGroups, enrollmentGroups] = await Promise.all([
        Promise.all(ownerUids.map((uid) => listPeople(uid).catch(() => []))),
        Promise.all(ownerUids.map((uid) => listEnrollments(uid).catch(() => []))),
      ])

      let mergedPeople = mergeById(peopleGroups.flat())
      let mergedEnrollments = mergeById(enrollmentGroups.flat())

      if (!canManageStructure) {
        const visibleClassIds = new Set(visibleRegisters.map((item) => item.classId).filter(Boolean))
        const visibleStudentIds = new Set([
          ...visibleRegisters.flatMap((item) => getRegisterStudentIds(item)),
          ...mergedEnrollments
            .filter((item) => visibleClassIds.has(item?.classId))
            .map((item) => item?.personId)
            .filter(Boolean),
        ])

        mergedEnrollments = mergedEnrollments.filter((item) => visibleClassIds.has(item?.classId))
        mergedPeople = mergedPeople.filter((item) => visibleStudentIds.has(item?.id))
      }

      setPeople(mergedPeople)
      setEnrollments(mergedEnrollments)
      setAttendanceRegisters(visibleRegisters)
    }

    load()
  }, [canManageStructure, profile, user, user?.uid])

  const dashboardOverview = useMemo(
    () => calculateDashboardOverview({
      people,
      enrollments,
      attendanceRegisters,
    }),
    [attendanceRegisters, enrollments, people],
  )

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">{canManageStructure ? 'Painel da Superintendência' : 'Painel do Professor'}</h2>
          <p className="feature-subtitle">
            Indicadores unificados de pessoas, matrículas reais e frequência recente da EBD.
          </p>
        </div>
        <Button onClick={() => navigate('/caderneta')}>
          {canManageStructure ? 'Abrir Cadernetas' : 'Abrir Minha Caderneta'}
        </Button>
      </div>

      <DashboardTimerCard
        countdown={timeline}
        canManageStructure={canManageStructure}
        onOpenPanel={() => navigate('/comunicacao')}
        onEditSchedule={() => navigate('/configuracoes')}
      />

      <div className="grid-cards grid-cards--triple">
        <SummaryCard
          label="Total de Pessoas"
          value={String(dashboardOverview.totalPeople)}
          color="primary"
          icon="👥"
          onClick={canManageStructure ? () => navigate('/alunos') : undefined}
        />
        <SummaryCard
          label="Matriculados Ativos"
          value={String(dashboardOverview.activeEnrolledCount)}
          color="warning"
          icon="🧾"
          onClick={canManageStructure ? () => navigate('/matriculas') : undefined}
        />
        <SummaryCard
          label="Frequentantes"
          value={String(dashboardOverview.frequentCount)}
          color="success"
          icon="📈"
        />
      </div>

      <Card>
        <div className="card-header">
          <div>
            <h3 className="card-title">Frequência real aula a aula</h3>
            <p className="card-subtitle">
              Trimestre atual: {dashboardOverview.quarterLabel}. O gap entre matriculados e presentes mostra onde a falta apertou mais.
            </p>
          </div>
        </div>

        {dashboardOverview.frequencyTimeline.length > 0 ? (
          <>
            <div className="summary-grid dashboard-frequency-summary">
              <div className="summary-item">
                <span className="summary-label">Frequentantes</span>
                <span className="summary-value">{dashboardOverview.frequentCount}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Inativos</span>
                <span className="summary-value">{dashboardOverview.inactiveCount}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Última aula</span>
                <span className="summary-value">{dashboardOverview.frequencyTimeline.at(-1)?.presentes ?? 0}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Gap da última aula</span>
                <span className="summary-value">{dashboardOverview.frequencyTimeline.at(-1)?.gapFaltas ?? 0}</span>
              </div>
            </div>

            <div className="dashboard-frequency-chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={dashboardOverview.frequencyTimeline} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="count" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value, name) => [value, name]}
                    labelFormatter={(label, payload) => {
                      const entry = payload?.[0]?.payload
                      if (!entry) return label
                      return `${label} • Presentes: ${entry.presentes} • Matriculados: ${entry.matriculados} • Gap: ${entry.gapFaltas} • %: ${entry.percentual.toFixed(1)}%`
                    }}
                  />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="count" dataKey="gapFaltas" name="Gap de faltas" fill="#fde68a" radius={[6, 6, 0, 0]} />
                  <Line yAxisId="count" type="monotone" dataKey="presentes" name="Presentes" stroke="#15803d" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  <Line yAxisId="count" type="monotone" dataKey="matriculados" name="Matriculados" stroke="#b45309" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <p className="feature-subtitle">
            Ainda não há aulas com presença registrada para montar a curva de frequência real.
          </p>
        )}
      </Card>
    </div>
  )
}
