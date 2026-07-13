# Migrador EBD — dry run

O migrador é somente de leitura em relação ao Firebase. Ele nunca grava, atualiza ou apaga documentos e nunca altera contas do Firebase Authentication.

## Execução segura com snapshot local

```powershell
npm run migration:dry-run -- --input caminho\snapshot.json --out migration-dry-run-output --church-id igreja-principal --church-name "Igreja principal"
```

Formato mínimo do snapshot:

```json
{
  "metadata": { "source": "nome-da-origem", "projectId": "opcional" },
  "authUsersIncluded": true,
  "authUsers": [
    { "uid": "uid", "email": "pessoa@example.com", "disabled": false }
  ],
  "firestoreDocuments": [
    {
      "path": "users/uid/ebd_people/person-id",
      "data": { "fullName": "Pessoa" }
    }
  ]
}
```

Saídas:

- `migration-dry-run-report.json`: dados completos, documentos propostos e mapeamentos.
- `migration-dry-run-report.md`: relatório administrativo legível.

## Testes simulados

```powershell
npm run test:migration
```

## Leitura do Firebase real

Não executar sem nova autorização explícita.

O adaptador real usa `firebase-admin` apenas para:

- `Auth.listUsers`;
- leitura da coleção `users`;
- leitura por `collectionGroup` das coleções EBD conhecidas;
- descoberta/leitura de outras subcoleções `ebd_*` por usuário;
- leitura de `ebdSystemSettings`.

Ele não importa funções de escrita do Firestore/Auth. A dependência é opcional e não foi adicionada ao aplicativo:

As coleções oficiais conhecidas são encontradas por `collectionGroup`, inclusive quando o documento pai `users/{uid}` não existe. A API do Firestore não permite descobrir genericamente uma coleção `ebd_*` de nome desconhecido quando o UID pai também não aparece nem em `users` nem no Auth; esse caso extremo é declarado nas limitações do relatório.

```powershell
npm install --no-save firebase-admin
npm run migration:dry-run -- --source firebase --confirm-real-read --project-id PROJECT_ID --service-account caminho\service-account.json --out migration-dry-run-output --church-id igreja-principal
```

Sem `--confirm-real-read`, o adaptador encerra antes de carregar SDK ou credenciais.

## Opções

- `--run-at <ISO-8601>`: fixa o instante do relatório para reprodutibilidade.
- `--default-lesson-start-time <HH:mm>`: padrão quando a caderneta não contém horário.
- `--default-lesson-duration-minutes <n>`: duração padrão; default 50.
- `--church-id <id>` e `--church-name <nome>`: igreja candidata de destino.
