# Superintendência EBD

Aplicação mobile-first para gestão administrativa da Escola Bíblica Dominical, construída sobre React + Vite + Firebase.

## MVP atual

- Cadastro geral de pessoas (membros, frequentantes e visitantes)
- Cadastro de classes/departamentos
- Matrículas EBD (separadas do cadastro geral)
- Caderneta trimestral por classe
- Presença por domingo (ciclo: vazio -> PP -> P -> A)
- Cálculo automático por aluno e resumo geral da turma
- Exportação de PDF da caderneta
- Dashboard com métricas unificadas e gráfico de frequência real
- Painel de controle de aula com cronômetro, GPS e alerta de encerramento
- Histórico retroativo de cadernetas em modo somente leitura para professores
- Abertura rápida do Grupo da EBD no WhatsApp
- Relatório de pontualidade e extrapolação da aula

## Como rodar

```bash
npm install
npm run dev
```

O app também funciona em modo local (mock) quando as credenciais do Firebase não estão configuradas.

## Push em background

O projeto já possui:

- `service worker` com suporte a evento `push`
- registro do dispositivo e da subscription no navegador
- UI para ativar alertas no celular

Para o alerta completo com o app fechado, ainda é necessário:

1. Configurar `VITE_WEB_PUSH_PUBLIC_KEY`
2. Configurar `WEB_PUSH_PRIVATE_KEY`
3. Ter um backend/job para enviar o push às 19:10

Veja o guia em [PUSH_WEB_SETUP.md](./PUSH_WEB_SETUP.md).

## Estrutura principal

```text
src/
  features/
    dashboard/
    people/
    classes/
    enrollments/
    attendance/
    communication/
    reports/
    materials/
    settings/
  components/
    layout/
    ui/
  services/
    ebdDataService.js
    peopleService.js
    classService.js
    enrollmentService.js
    attendanceService.js
    pdfService.js
  utils/
    attendanceUtils.js
```

## Fluxo recomendado de teste

1. Criar pessoas em Pessoas
2. Criar classes em Classes
3. Fazer matrículas em Matrículas
4. Criar caderneta em Caderneta Mensal
5. Marcar presença por domingo
6. Validar cálculos por aluno e resumo da turma
7. Exportar PDF
