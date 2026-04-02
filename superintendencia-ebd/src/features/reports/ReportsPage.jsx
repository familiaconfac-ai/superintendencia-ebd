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
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { listLessonSessions } from '../../services/lessonControlService'

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

export default function ReportsPage() {
  const { user, canManageStructure } = useAuth()
  const [sessions, setSessions] = useState([])

  useEffect(() => {
    if (!user?.uid) return

    async function load() {
      const lessonSessions = await listLessonSessions(user.uid, {
        includeAll: canManageStructure,
      }).catch(() => [])

      setSessions(lessonSessions)
    }

    load()
  }, [canManageStructure, user?.uid])

  const summary = useMemo(() => {
    const totalSessions = sessions.length
    const confirmedPresence = sessions.filter((session) => session?.presenceConfirmed).length
    const punctualSessions = sessions.filter((session) => session?.punctualityOk).length
    const extrapolatedSessions = sessions.filter((session) => session?.finishStatus === 'extrapolated').length
    const finalizedSessions = sessions.filter((session) => !!session?.endedAt).length

    return {
      totalSessions,
      confirmedPresence,
      punctualSessions,
      extrapolatedSessions,
      finalizedSessions,
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
      if (!acc[teacherKey]) {
        acc[teacherKey] = {
          teacherName: session?.teacherName || 'Professor nao identificado',
          total: 0,
          pontuais: 0,
          extrapoladas: 0,
        }
      }

      acc[teacherKey].total += 1
      if (session?.punctualityOk) acc[teacherKey].pontuais += 1
      if (session?.finishStatus === 'extrapolated') acc[teacherKey].extrapoladas += 1

      return acc
    }, {})

    return Object.values(grouped)
      .map((item) => ({
        ...item,
        taxaPontualidade: item.total ? (item.pontuais / item.total) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total)
  }, [sessions])

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => String(b.lessonDateKey || '').localeCompare(String(a.lessonDateKey || ''))),
    [sessions],
  )

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Relatorios</h2>
          <p className="feature-subtitle">
            {canManageStructure
              ? 'Painel consolidado de pontualidade, check-in e extrapolacao das aulas.'
              : 'Historico pessoal de pontualidade, check-in e encerramento das suas aulas.'}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Resumo da aula"
          subtitle="Indicadores consolidados das sessoes registradas pelo painel de controle."
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
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Curva de extrapolacao por domingo"
          subtitle="Comparativo entre aulas pontuais e extrapoladas nas ultimas 8 datas registradas."
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
          <p className="feature-subtitle">Ainda nao ha sessoes suficientes para montar o grafico.</p>
        )}
      </Card>

      {canManageStructure && (
        <Card>
          <CardHeader
            title="Comparativo por professor"
            subtitle="Ajuda a superintendencia a identificar quem esta mantendo o horario e quem precisa de acompanhamento."
          />
          <div className="entity-list">
            {teacherRows.length === 0 && <p className="feature-subtitle">Nenhum professor com sessoes registradas ainda.</p>}
            {teacherRows.map((teacher) => (
              <div key={teacher.teacherName} className="entity-row">
                <div>
                  <div className="entity-title">{teacher.teacherName}</div>
                  <div className="entity-meta">
                    {teacher.total} aula(s) • {teacher.pontuais} pontual(is) • {teacher.extrapoladas} extrapolada(s)
                  </div>
                </div>
                <span className={`entity-status ${teacher.extrapoladas > 0 ? 'inactive' : 'active'}`}>
                  {teacher.taxaPontualidade.toFixed(0)}% pontual
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Ultimos registros"
          subtitle="Linha do tempo dos fechamentos de aula para auditoria rapida."
        />
        <div className="entity-list">
          {orderedSessions.length === 0 && <p className="feature-subtitle">Nenhum registro de aula encontrado.</p>}
          {orderedSessions.map((session) => (
            <div key={`${session.storageOwnerUid || 'uid'}-${session.id}`} className="entity-row">
              <div>
                <div className="entity-title">
                  {canManageStructure ? session.teacherName || 'Professor nao identificado' : formatSessionDate(session.lessonDateKey)}
                </div>
                <div className="entity-meta">
                  {canManageStructure ? formatSessionDate(session.lessonDateKey) : 'Sua aula'} • Check-in: {session.presenceConfirmed ? 'Confirmado' : 'Pendente'} • Termino: {formatSessionTime(session.endedAt)}
                </div>
              </div>
              <span className={`entity-status ${session.finishStatus === 'extrapolated' ? 'inactive' : 'active'}`}>
                {session.finishStatus === 'extrapolated' ? 'Extrapolada' : 'No horario'}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
