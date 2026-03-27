# 💸 Learnendo Finanças

App mobile-first de finanças pessoais e orçamento familiar.  
Stack: **React + Vite + Firebase** · Deploy: **Vercel**

---

## 🚀 Como rodar localmente

```bash
# 1. Instalar dependências
npm install

# 2. Configurar Firebase
cp .env.example .env
# edite .env com suas credenciais do Firebase Console

# 3. Iniciar servidor de desenvolvimento
npm run dev
# acesse http://localhost:5174
```

---

## 📁 Estrutura de pastas

```
learnendo-financas/
├── public/
│   └── favicon.jpg
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.jsx / .css
│   │   │   ├── BottomNav.jsx / .css
│   │   │   ├── HamburgerMenu.jsx / .css
│   │   │   └── Layout.jsx / .css
│   │   └── ui/
│   │       ├── Card.jsx / .css        (Card, CardHeader, SummaryCard)
│   │       ├── Button.jsx / .css
│   │       ├── Modal.jsx / .css       (bottom-sheet mobile)
│   │       ├── Loading.jsx / .css
│   │       └── MonthSelector.jsx / .css
│   ├── context/
│   │   ├── AuthContext.jsx            (user, profile, isAdmin)
│   │   └── FinanceContext.jsx         (selectedMonth, selectedYear)
│   ├── firebase/
│   │   ├── config.js
│   │   ├── auth.js
│   │   └── firestore.js
│   ├── pages/
│   │   ├── auth/         Login.jsx, Register.jsx
│   │   ├── dashboard/    Dashboard.jsx
│   │   ├── lancamentos/  Lancamentos.jsx
│   │   ├── orcamento/    Orcamento.jsx
│   │   ├── mensal/       Mensal.jsx
│   │   ├── relatorios/   Relatorios.jsx
│   │   ├── perfil/       Perfil.jsx
│   │   └── admin/        AdminDashboard.jsx
│   ├── routes/
│   │   ├── AppRoutes.jsx
│   │   ├── PrivateRoute.jsx
│   │   └── AdminRoute.jsx
│   ├── services/
│   │   ├── transactionService.js
│   │   ├── budgetService.js
│   │   └── pdfService.js
│   ├── utils/
│   │   ├── formatCurrency.js
│   │   ├── formatDate.js
│   │   └── mockData.js
│   ├── styles/
│   │   └── global.css
│   ├── App.jsx
│   └── main.jsx
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── vite.config.js
└── vercel.json
```

---

## 🗂️ Modelo de dados – Firestore

### `users/{uid}`
```json
{
  "uid": "string",
  "email": "string",
  "displayName": "string",
  "role": "user | admin",
  "createdAt": "Timestamp"
}
```

### `transactions/{id}`
```json
{
  "userId": "string",
  "type": "receita | despesa | investimento",
  "description": "string",
  "amount": "number",
  "date": "ISO string",
  "category": "string",
  "note": "string",
  "recurring": "boolean",
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

### `budgets/{id}`
```json
{
  "userId": "string",
  "year": "number",
  "month": "number",
  "categories": [
    {
      "id": "string",
      "name": "string",
      "budgeted": "number",
      "subcategories": [
        { "id": "string", "name": "string", "budgeted": "number" }
      ]
    }
  ],
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

### `monthlySummaries/{userId_year_month}`
```json
{
  "userId": "string",
  "year": "number",
  "month": "number",
  "receitas": "number",
  "despesas": "number",
  "investimentos": "number",
  "saldo": "number",
  "updatedAt": "Timestamp"
}
```

### `categories/{id}` *(opcional – lista global de categorias)*
```json
{
  "name": "string",
  "type": "despesa | receita | investimento",
  "icon": "string",
  "order": "number"
}
```

---

## 🗺️ Rotas do app

| Rota           | Componente         | Acesso    |
|----------------|--------------------|-----------|
| `/login`       | Login              | Público   |
| `/cadastro`    | Register           | Público   |
| `/dashboard`   | Dashboard          | Autenticado |
| `/lancamentos` | Lancamentos        | Autenticado |
| `/orcamento`   | Orcamento          | Autenticado |
| `/mensal`      | Mensal             | Autenticado |
| `/relatorios`  | Relatorios         | Autenticado |
| `/perfil`      | Perfil             | Autenticado |
| `/admin`       | AdminDashboard     | Admin only |

---

## 📋 Plano de implementação por etapas

### ✅ Etapa 1 – Base (concluída)
- [x] Estrutura de pastas e arquivos de configuração
- [x] Firebase Auth + Firestore configurados
- [x] Contextos de autenticação e finanças
- [x] Layout mobile-first: Header fixo, BottomNav fixa, Menu hambúrguer
- [x] Componentes UI: Card, Button, Modal (bottom-sheet), MonthSelector, Loading
- [x] Sistema de rotas com PrivateRoute e AdminRoute
- [x] Todas as páginas com layout funcional e dados mockados
- [x] Serviços: transactionService, budgetService, pdfService
- [x] Exportação de PDF com jsPDF + autoTable
- [x] Gráficos com Recharts (relatórios)
- [x] Configuração de deploy na Vercel

---

### 🔜 Etapa 2 – Integração Firebase real
- [ ] Substituir `MOCK_SUMMARY` por hook `useSummary(month, year)`
- [ ] Substituir `MOCK_TRANSACTIONS` por hook `useTransactions(month, year)`
- [ ] Substituir `MOCK_BUDGET` por hook `useBudget(month, year)`
- [ ] Implementar salvar/editar/excluir lançamentos no Firestore
- [ ] Implementar salvar/editar orçamento por mês no Firestore
- [ ] Criar índices compostos no Firestore (userId + date, userId + month/year)

---

### 🔜 Etapa 3 – Funcionalidades avançadas
- [ ] Filtros avançados na tela de lançamentos (por categoria, por período)
- [ ] Lançamentos recorrentes: replicar para meses seguintes
- [ ] Orçamento anual: definir valores para 12 meses de uma vez
- [ ] Percentual de reserva de emergência no orçamento
- [ ] Relatório anual (jan–dez) com gráfico de evolução
- [ ] Relatório por categoria com evolução mensal

---

### 🔜 Etapa 4 – Painel admin
- [ ] Listar todos os usuários reais do Firestore
- [ ] Ver resumo financeiro de cada usuário por mês
- [ ] PDF consolidado por usuário e PDF geral
- [ ] Gerenciar categorias globais

---

### 🔜 Etapa 5 – Polimento e PWA
- [ ] Instalar como PWA (manifest.json + service worker)
- [ ] Notificações de alerta quando orçamento ultrapassado
- [ ] Modo offline (cache Firestore)
- [ ] Tema escuro (dark mode)
- [ ] Testes unitários (Vitest)

---

## 🔑 Configurar Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Crie um projeto ou use o existente do Learnendo
3. Ative **Authentication > E-mail/senha**
4. Crie o **Firestore Database** em modo de produção
5. Adicione as regras de segurança abaixo ao Firestore:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Usuário acessa apenas seus próprios dados
    match /transactions/{docId} {
      allow read, write: if request.auth != null
        && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.userId;
    }
    match /budgets/{docId} {
      allow read, write: if request.auth != null
        && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.userId;
    }
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    // Admin lê tudo
    match /{document=**} {
      allow read: if request.auth != null
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
  }
}
```

---

## 🚢 Deploy na Vercel

1. Suba o código para um repositório GitHub
2. No painel da Vercel, importe o repositório
3. Configure as variáveis de ambiente (as mesmas do `.env`)
4. O arquivo `vercel.json` já está configurado para SPA routing

---

## 🎨 Identidade visual

| Token                  | Valor     | Uso                           |
|------------------------|-----------|-------------------------------|
| `--color-primary`      | `#1a56db` | Azul-índigo – cor principal   |
| `--color-success`      | `#16a34a` | Verde – receitas positivas    |
| `--color-danger`       | `#dc2626` | Vermelho – despesas, alertas  |
| `--color-warning`      | `#d97706` | Âmbar – investimentos, avisos |

---

*Learnendo Finanças – versão 1.0.0*
