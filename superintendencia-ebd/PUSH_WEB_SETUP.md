# Push Web Setup

Este projeto ja esta preparado no cliente para:

- pedir permissao de notificacao
- registrar o dispositivo no navegador
- salvar subscriptions em `ebdPushDevices`
- receber `push` no `service-worker`

O que falta para producao e a camada de envio no servidor.

## Variaveis de ambiente

No frontend:

```env
VITE_WEB_PUSH_PUBLIC_KEY=your_public_vapid_key
VITE_EBD_GROUP_LINK=https://chat.whatsapp.com/seu-link-oficial
```

No backend ou ambiente serverless:

```env
WEB_PUSH_PRIVATE_KEY=your_private_vapid_key
WEB_PUSH_SUBJECT=mailto:suporte@exemplo.com
```

## Fluxo esperado

1. O professor ativa as notificacoes no painel de aula.
2. O navegador registra a subscription.
3. A subscription e salva em `ebdPushDevices`.
4. Um job do servidor roda aos domingos, as 19:10.
5. O job busca devices com `status=push_ready`.
6. O job envia a notificacao com titulo, corpo, vibracao e URL `/comunicacao`.

## Payload recomendado

```json
{
  "title": "Painel de Controle de Aula",
  "body": "⚠️ Faltam 10 minutos! Inicie a conclusão da aula.",
  "tag": "lesson-warning",
  "requireInteraction": true,
  "url": "/comunicacao",
  "vibrate": [250, 120, 250]
}
```

## Observacoes

- Sem `VITE_WEB_PUSH_PUBLIC_KEY`, o app fica em `notification_only`.
- Nesse modo, o navegador ainda pode mostrar notificacoes locais com o app aberto, mas nao ha push real com o app fechado.
- O service worker ja esta preparado para `push` e `notificationclick`.

## Proximo passo tecnico

Criar um endpoint serverless ou job agendado que:

- leia `ebdPushDevices`
- filtre subscriptions validas
- envie a notificacao usando VAPID
- registre falhas de endpoint expirado para limpeza posterior
