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
import { listAttendanceRegisters } from '../../services/attendanceService'
import { listEnrollments } from '../../services/enrollmentService'
import { listPeople } from '../../services/peopleService'
import useLessonCountdown from '../../hooks/useLessonCountdown'
import { canAccessAttendanceRegister } from '../../utils/accessControl'
import { calculateDashboardOverview } from '../../utils/dashboardMetrics'
import { LESSON_CONTROL_CONFIG } from '../../utils/lessonControl'

function DashboardTimerCard({ countdown, onOpenPanel }) {
  const isActiveWindow = countdown.isLessonWindow || countdown.isExpired

  return (
    <Card className={`dashboard-timer-card${countdown.isWarning ? ' warning' : ''}${countdown.isExpired ? ' expired' : ''}`}>
      <div className="card-header">
        <div>
          <h3 className="card-title">Cronometro inteligente da aula</h3>
          <p className="card-subtitle">
            O gongo dispara as 19:10 e a finalizacao da aula fica disponivel as 19:20.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onOpenPanel}>
          Abrir Painel
        </Button>
      </div>

      {isActiveWindow ? (
        <div className={`dashboard-timer-grid${countdown.isWarning ? ' critical' : ''}`}>
          <div>
            <span>Inicio</span>
            <strong>{countdown.lessonStartTime}</strong>
          </div>
          <div>
            <span>Contagem regressiva</span>
            <strong>{countdown.isExpired ? '00:00:00' : countdown.countdownLabel}</strong>
          </div>
          <div>
            <span>Termino</span>
            <strong>{countdown.endTime}</strong>
          </div>
        </div>
      ) : (
        <div className="dashboard-timer-idle">
          <strong>{countdown.statusLabel}</strong>
          <span>
            Quando o professor entrar no domingo, o painel mostra a contagem de 50 minutos entre 18h30 e 19h20.
          </span>
        </div>
      )}

      {countdown.isWarning && (
        <div className="dashboard-timer-warning-banner">
          Faltam 10 min para o Gongo!
        </div>
      )}
    </Card>
  )
}

export default function DashboardPage() {
  const { user, profile, canManageStructure } = useAuth()
  const navigate = useNavigate()
  const [people, setPeople] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [attendanceRegisters, setAttendanceRegisters] = useState([])

  useEffect(() => {
    if (!user?.uid) return

    async function load() {
      const [peopleList, enrollmentList, registerList] = await Promise.all([
        listPeople(user.uid),
        listEnrollments(user.uid),
        listAttendanceRegisters(user.uid),
      ])

      const visibleRegisters = canManageStructure
        ? registerList
        : registerList.filter((item) => canAccessAttendanceRegister(item, user, profile))

      setPeople(peopleList)
      setEnrollments(enrollmentList)
      setAttendanceRegisters(visibleRegisters)
    }

    load()
  }, [canManageStructure, profile, user, user?.uid])

  const countdown = useLessonCountdown(LESSON_CONTROL_CONFIG.lessonEndTime)

  const dashboardOverview = useMemo(
    () => calculateDashboardOverview({
      people,
      enrollments,
      attendanceRegisters,
    }),
    [attendanceRegisters, enrollments, people],
  )

  useEffect(() => {
    console.log('[DASHBOARD_DEBUG] overview', {
      totalPeople: dashboardOverview.totalPeople,
      activeEnrolledCount: dashboardOverview.activeEnrolledCount,
      frequentCount: dashboardOverview.frequentCount,
      inactiveCount: dashboardOverview.inactiveCount,
      timelineSample: dashboardOverview.frequencyTimeline.slice(-3),
    })
  }, [dashboardOverview])

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">{canManageStructure ? 'Painel da Superintendencia' : 'Painel do Professor'}</h2>
          <p className="feature-subtitle">
            Indicadores unificados de pessoas, matriculas reais e frequencia recente da EBD.
          </p>
        </div>
        <Button onClick={() => navigate('/caderneta')}>
          {canManageStructure ? 'Abrir Cadernetas' : 'Abrir Minha Caderneta'}
        </Button>
      </div>

      <DashboardTimerCard
        countdown={countdown}
        onOpenPanel={() => navigate('/comunicacao')}
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
          label="Frequentes"
          value={String(dashboardOverview.frequentCount)}
          color="success"
          icon="📈"
        />
      </div>

      <Card>
        <div className="card-header">
          <div>
            <h3 className="card-title">Frequencia real domingo a domingo</h3>
            <p className="card-subtitle">
              Trimestre atual: {dashboardOverview.quarterLabel}. O gap entre matriculados e presentes mostra onde a falta apertou mais.
            </p>
          </div>
        </div>

        {dashboardOverview.frequencyTimeline.length > 0 ? (
          <>
            <div className="summary-grid dashboard-frequency-summary">
              <div className="summary-item">
                <span className="summary-label">Frequentes</span>
                <span className="summary-value">{dashboardOverview.frequentCount}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Inativos</span>
                <span className="summary-value">{dashboardOverview.inactiveCount}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Ultimo domingo</span>
                <span className="summary-value">{dashboardOverview.frequencyTimeline.at(-1)?.presentes ?? 0}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Gap do ultimo domingo</span>
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
                    formatter={(value, name) => {
                      if (name === '% Presenca') return [`${Number(value).toFixed(1)}%`, name]
                      return [value, name]
                    }}
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
            Ainda nao ha domingos com presenca registrada para montar a curva de frequencia real.
          </p>
        )}
      </Card>
    </div>
  )
}
