import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Card, { SummaryCard } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { listPeople } from '../../services/peopleService'
import { listTeachers } from '../../services/teacherService'
import { listClasses } from '../../services/classService'
import { listEnrollments } from '../../services/enrollmentService'
import { getCommunicationSettings } from '../../services/communicationSettingsService'
import useLessonCountdown from '../../hooks/useLessonCountdown'
import { calculateMemberEnrollmentMetrics, isEnrollmentCurrentlyActive } from '../../utils/enrollmentMetrics'

export default function DashboardPage() {
  const { user, canManageStructure } = useAuth()
  const navigate = useNavigate()

  const [people, setPeople] = useState([])
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [communicationSettings, setCommunicationSettings] = useState(null)

  useEffect(() => {
    if (!user?.uid) return

    async function load() {
      const [peopleList, teacherList, classList, enrollmentList, settings] = await Promise.all([
        listPeople(user.uid),
        listTeachers(user.uid),
        listClasses(user.uid),
        listEnrollments(user.uid),
        getCommunicationSettings().catch(() => null),
      ])
      setPeople(peopleList)
      setTeachers(teacherList)
      setClasses(classList)
      setEnrollments(enrollmentList)
      setCommunicationSettings(settings)
    }

    load()
  }, [user?.uid])

  const countdown = useLessonCountdown(communicationSettings?.lessonEndTime || '19:20')

  // Fonte oficial do dashboard:
  // pessoas cadastradas = base geral ativa da EBD
  // matriculas ativas = pessoas unicas atualmente vinculadas, igual a tela Matriculas EBD.
  const memberMetrics = useMemo(
    () => calculateMemberEnrollmentMetrics(people, enrollments),
    [people, enrollments],
  )

  const totalPeople = useMemo(
    () => people.filter((item) => item.active !== false).length,
    [people],
  )
  const totalTeachers = useMemo(
    () => teachers.filter((item) => item.active !== false).length,
    [teachers],
  )
  const totalClasses = useMemo(
    () => classes.filter((item) => item.active !== false).length,
    [classes],
  )
  const totalActiveEnrollments = useMemo(
    () => memberMetrics.currentEnrolledMembers,
    [memberMetrics.currentEnrolledMembers],
  )

  useEffect(() => {
    console.log('[DASHBOARD_DEBUG] pessoas', {
      collection: 'people',
      filtros: {
        active: 'active !== false',
      },
      quantidadeFinal: totalPeople,
      amostra: people
        .filter((item) => item?.active !== false)
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          fullName: item.fullName,
          churchStatus: item.churchStatus,
          active: item.active,
        })),
    })

    console.log('[DASHBOARD_DEBUG] professores', {
      collection: 'teachers',
      filtros: {
        active: 'active !== false',
      },
      quantidadeFinal: totalTeachers,
      amostra: teachers
        .filter((item) => item?.active !== false)
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          fullName: item.fullName,
          email: item.email,
          active: item.active,
        })),
    })

    console.log('[DASHBOARD_DEBUG] classesAtivas', {
      collection: 'classes',
      filtros: {
        active: 'active !== false',
      },
      quantidadeFinal: totalClasses,
      amostra: classes
        .filter((item) => item?.active !== false)
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          name: item.name,
          active: item.active,
          defaultTeacherId: item.defaultTeacherId,
        })),
    })

    console.log('[DASHBOARD_DEBUG] matriculasAtivas', {
      collection: 'enrollments',
      filtros: {
        pessoaBaseOficial: "people.active !== false && people.churchStatus === 'member'",
        matriculaAtiva: "status === 'active' && enrolledInEBD !== false",
        regraContagem: 'conta membros unicos matriculados, igual a tela Matriculas EBD',
      },
      quantidadeFinal: totalActiveEnrollments,
      amostra: enrollments
        .filter((item) => isEnrollmentCurrentlyActive(item))
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          personId: item.personId,
          classId: item.classId,
          status: item.status,
          enrolledInEBD: item.enrolledInEBD,
        })),
    })
  }, [classes, enrollments, people, teachers, totalActiveEnrollments, totalClasses, totalPeople, totalTeachers])

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Painel da Superintendencia</h2>
          <p className="feature-subtitle">
            {canManageStructure ? 'Gestao administrativa da Escola Biblica Dominical' : 'Area do professor para acompanhamento da EBD'}
          </p>
        </div>
        <Button onClick={() => navigate('/caderneta')}>
          {canManageStructure ? 'Nova Caderneta' : 'Abrir Caderneta'}
        </Button>
      </div>

      {canManageStructure && (
        <Card className={`dashboard-timer-card${countdown.isWarning ? ' warning' : ''}`}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Cronometro da aula</h3>
              <p className="card-subtitle">A contagem fica vermelha nos ultimos 10 minutos para apoiar o disparo rapido dos avisos.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/comunicacao')}>
              Abrir Central
            </Button>
          </div>
          <div className="dashboard-timer-grid">
            <div>
              <span>Horario final</span>
              <strong>{communicationSettings?.lessonEndTime || '19:20'}</strong>
            </div>
            <div>
              <span>Contagem regressiva</span>
              <strong>{countdown.countdownLabel}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{countdown.isExpired ? 'Encerrada' : countdown.isWarning ? 'Faltam 10 minutos' : 'Em andamento'}</strong>
            </div>
          </div>
        </Card>
      )}

      <div className="grid-cards">
        <SummaryCard label="Pessoas cadastradas" value={String(totalPeople)} color="primary" icon="👥" onClick={() => navigate('/alunos')} clickable />
        <SummaryCard label="Professores" value={String(totalTeachers)} color="secondary" icon="🧑‍🏫" onClick={() => navigate('/professores')} clickable />
        <SummaryCard label="Classes ativas" value={String(totalClasses)} color="success" icon="🏫" onClick={() => navigate('/classes')} clickable />
        <SummaryCard label="Matriculas ativas" value={String(totalActiveEnrollments)} color="warning" icon="🧾" onClick={() => navigate('/matriculas')} clickable />
      </div>
    </div>
  )
}
