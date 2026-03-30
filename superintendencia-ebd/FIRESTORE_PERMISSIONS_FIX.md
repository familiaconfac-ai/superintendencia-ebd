# 🔐 CORREÇÃO DE PERMISSÕES DO FIRESTORE

## 📋 Problema Identificado
**O erro "Missing or insufficient permissions" ocorria porque as regras de segurança do Firestore estavam bloqueando escrita.**

As regras padrão do Firebase muitas vezes negam todas as operações. O app tenta salvar em `users/{uid}/ebd_teachers` mas a regra não permitia.

---

## 🔧 SOLUÇÃO

### 1️⃣ COPIE AS REGRAS ABAIXO

Abra o [Firebase Console](https://console.firebase.google.com/):
1. Vá até **Firestore Database**
2. Clique na aba **Rules**
3. **Apague tudo** e **cole** exatamente isto:

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Nega tudo por padrão
    match /{document=**} {
      allow read, write: if false;
    }

    // Permite que usuários autenticados escrevam e leiam seus próprios dados
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth.uid == uid;
    }
  }
}
```

### 2️⃣ CLIQUE EM "PUBLISH"

- Aguarde a confirmação: ✅ "Rules updated successfully"

### 3️⃣ TESTE O CADASTRO

- Retorne ao app
- Abra **DevTools** (F12 → Console)
- Tente cadastrar um professor novo
- Veja os logs:
  ```
  🔐 [ebdDataService] saveEbdDocument iniciado
  🔐 [ebdDataService] UID do usuário: xxx123...
  🔐 [ebdDataService] Collection path: users/xxx123.../ebd_teachers
  🔐 [ebdDataService] Operação: INSERT
  🔐 [ebdDataService] Criando novo documento
  ✅ [ebdDataService] Documento criado com sucesso. ID: abc456...
  ```

- Se houver erro:
  ```
  ❌ [ebdDataService] ERRO ao criar documento: permission-denied 
  Missing or insufficient permissions
  ```
  → Significa a rule NÃO foi aplicada. Aguarde 1-2 minutos e tente novamente.

---

## 📊 FLUXO DE SALVAMENTO

```
TeachersPage.jsx
    ↓ handleSave()
    ↓ saveTeacher(user.uid, {...})
    ↓ saveEbdDocument(uid, 'teachers', {...})
    ↓ Collection path: users/{uid}/ebd_teachers
    ↓ setDoc(ref, {...})  ← AQUI TESTA A PERMISSÃO
    ✅ ou ❌
```

---

## 🔐 O QUE AS REGRAS FAZEM

| Rule | Comportamento |
|------|--------|
| `match /{document=**}` | Qualquer acesso em raiz = NEGADO |
| `request.auth.uid == uid` | Apenas o usuário autenticado pode ler/escrever |
| `users/{uid}/{document=**}` | Valida recursivamente subcoleções |

**Segurança:** 
- ✅ Usuários anônimos não conseguem acessar nada
- ✅ Usuario A não consegue ler dados do usuario B  
- ✅ Dados de professores ficarao em `users/{uid}/ebd_teachers`
- ✅ Dados de alunos ficarao em `users/{uid}/ebd_people`
- etc.

---

## 📁 ARQUIVO CRIADO NO PROJETO

Um arquivo `firestore.rules` foi criado no root do projeto com as regras acima. Você pode manter como referência ou deletar se preferir.

---

## ✅ PRÓXIMOS PASSOS

1. Abra Firebase Console
2. Copie e cole as rules acima
3. Clique "Publish"  
4. Volte ao app e teste
5. Veja os logs no Console (F12)
6. Se funcionar → ✅ Problema resolvido!
7. Se erro → Compartilhe a mensagem do Console comigo

---

## 🐛 DEBUG

**Logs esperados após sucesso:**

```javascript
🔐 [ebdDataService] saveEbdDocument iniciado
🔐 [ebdDataService] UID do usuário: mXxZ9Kp2Q...
🔐 [ebdDataService] Bucket: teachers
🔐 [ebdDataService] Collection path: users/mXxZ9Kp2Q.../ebd_teachers
🔐 [ebdDataService] Operação: INSERT
🔐 [ebdDataService] Criando novo documento
🔐 [ebdDataService] Doc ref ID: abc123def456...
✅ [ebdDataService] Documento criado com sucesso. ID: abc123def456...
✅ [TeachersPage] Professor cadastrado com sucesso! ID: abc123def456...
```

**Se erro "permission-denied":**

```javascript
❌ [ebdDataService] ERRO ao criar documento: permission-denied
❌ Detalhes completos do erro: FirebaseError: Missing or insufficient permissions
```

→ Segredo: A rule não foi publicada ainda ou está mal escrita. Verifique a sintaxe no Firebase Console.

---

## 🎯 UMA FRASE EXPLICANDO O PROBLEMA

**O problema era: As regras de segurança do Firestore estavam com a configuração padrão bloqueando todas as escritas, mesmo de usuários autenticados.**
