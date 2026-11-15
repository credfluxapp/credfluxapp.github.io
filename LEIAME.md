# CredFlux

Sistema para investidores cadastrarem clientes e aportes (valor, taxa, vencimentos) e verem quanto vão receber por dia e por mês. Funciona no celular (pode ser instalado na tela inicial) e no computador.

Vendido por assinatura mensal paga por Pix: cada investidor cria a própria conta, com os dados isolados dos demais.

- Página: arquivos estáticos (GitHub Pages).
- Banco e login: Supabase (Postgres com regras de acesso por linha).
- Demonstração sem cadastro: `?demo` no fim do endereço (dados de exemplo guardados só no navegador).

## Publicar (uma vez, cerca de 20 minutos)

### 1. Supabase (banco e login)
1. Em https://supabase.com, crie um projeto novo (separado do SAGA). Região: São Paulo.
2. **SQL Editor**: abra `supabase/schema.sql`, troque `SEU_EMAIL@EXEMPLO.COM` pelo seu e-mail e rode o arquivo inteiro. Depois rode `supabase/atualizacao_01.sql` (taxa fixa em dias, multa, dados do acordo e documentos dos clientes; pode rodar de novo sem problema).
3. **Authentication › Sign In / Providers › Email**: deixe "Enable sign ups" ligado e **"Confirm email" ligado**.
   O "Confirm email" é obrigatório: é ele que impede alguém de criar acesso com o e-mail de outra pessoa.
4. **Project Settings › API**: copie a *Project URL* e a chave *anon / publishable* para o `config.js`.
   Nunca use a chave *service_role / secret* no `config.js`.

### 2. GitHub Pages (página)
1. Crie um repositório no GitHub (ex.: `aportes`).
2. Nesta pasta:
   ```
   git init -b main
   git add .
   git commit -m "Sistema de Aportes"
   git remote add origin https://github.com/SEU_USUARIO/aportes.git
   git push -u origin main
   ```
3. No repositório: **Settings › Pages › Source: Deploy from a branch › main / (root)**.
   Em 1 ou 2 minutos o endereço fica `https://SEU_USUARIO.github.io/aportes/`.

### 3. Ligar o login ao endereço
No Supabase, **Authentication › URL Configuration**:
- *Site URL*: `https://SEU_USUARIO.github.io/aportes/`
- *Redirect URLs*: o mesmo endereço.

Sem isso, os links de confirmação e de nova senha mandam a pessoa para o lugar errado.

### 4. Primeiro acesso
1. Abra o endereço, toque em **Criar acesso** com o seu e-mail e digite o código de confirmação que chega por e-mail (depois do passo 5, ele vem de credfluxapp@gmail.com).
2. Crie a sua conta de investidor.
3. Em **Configurações › Painel do administrador**, preencha o preço, os dias de teste, a chave Pix, o nome do recebedor e a cidade.

### 5. E-mails do CredFlux (credfluxapp@gmail.com)
Sem SMTP próprio, o Supabase só envia e-mails para quem é da equipe do projeto (os clientes não recebem nada) e no máximo 2 por hora. Com o Gmail do CredFlux, o código de confirmação e o link de nova senha saem de credfluxapp@gmail.com.
1. **Senha de app do Google**: entre em credfluxapp@gmail.com › Conta do Google › Segurança › ligue a **Verificação em duas etapas** › **Senhas de app** › crie uma chamada "Supabase CredFlux" e copie a senha de 16 letras. Não guarde essa senha em arquivo nenhum.
2. **Supabase › Authentication › Emails › SMTP Settings** › *Enable custom SMTP*:
   - Sender email: `credfluxapp@gmail.com` · Sender name: `CredFlux`
   - Host: `smtp.gmail.com` · Port: `465`
   - Username: `credfluxapp@gmail.com` · Password: a senha de app do passo 1
   - Minimum interval between emails: `60` segundos. Salve.
3. **Supabase › Authentication › Emails › Templates**:
   - *Confirm signup*: assunto "Seu código de confirmação do CredFlux"; no corpo, cole `supabase/emails/confirmar_cadastro.html`. O modelo manda o código (`{{ .Token }}`), que a pessoa digita na tela "Confirme seu e-mail" do CredFlux.
   - *Reset Password*: assunto "Crie uma nova senha no CredFlux"; no corpo, cole `supabase/emails/nova_senha.html`.
4. **Supabase › Authentication › Rate Limits**: suba o limite de e-mails por hora (o padrão com SMTP próprio é 30). O Gmail comum envia algumas centenas por dia; com muitos cadastros, troque por um serviço de e-mail transacional (Resend, Postmark, SendGrid).
5. Em **Sign In / Providers › Email**, deixe *Confirm email* ligado e o código com 6 dígitos valendo 1 hora (*Email OTP Length* 6, *Email OTP Expiration* 3600).

## Como funciona a assinatura
- Quem cria uma conta ganha os dias de teste definidos no painel.
- Em **Configurações › Assinatura e pagamento**, o investidor escolhe 1, 3, 6 ou 12 meses, paga pelo QR Code (ou copia e cola) e toca em **Já paguei**.
- No **Painel do administrador** aparece o pagamento com o valor e o código de identificação (ex.: `APT7DA679197849`), que também vai no Pix. Confira no extrato e toque em **Confirmar**: os meses somam à validade.
- Assinatura vencida: a conta fica **só para leitura** (vê tudo, não grava), até o pagamento ser confirmado.
- O administrador vê contas e pagamentos, nunca os clientes e aportes dos investidores.

## Formas de recebimento de um crédito
| Opção | Exemplo |
|---|---|
| Pagamento único | R$ 10.000 a 2% a.m., capital e juros em 6 meses |
| Juros a cada período e capital no último | R$ 200 por mês e os R$ 10.000 na última parcela |
| Parcelas iguais (Price) | 12 parcelas de R$ 945,60 |
| Amortização constante (SAC) | parcelas decrescentes |
| Parcelas definidas por mim | datas e valores livres |
| Taxa fixa em dias | R$ 1.000 + 10% = R$ 1.100 em 30 dias, em 11 parcelas de R$ 100 ou 20 de R$ 55 |

A frequência pode ser diária, semanal, quinzenal, mensal, bimestral, trimestral, semestral ou anual. A taxa pode ser ao mês ou ao ano, com juros simples ou compostos. Antes de gravar, dá para ajustar a data e o valor de cada parcela. Vencimento no domingo passa para a segunda.

## Recebimentos
- Opções rápidas: parcela inteira, só os juros ou outro valor.
- O dinheiro recebido paga primeiro a multa, depois os juros e por último o capital.
- Nas modalidades mensais, quando o valor recebido é diferente da parcela, as parcelas seguintes são refeitas sobre o novo saldo devedor. Juros que faltaram somam ao saldo.
- Em taxa fixa e em parcelas livres, a diferença passa para a próxima parcela.
- Multa de atraso por crédito, contada desde a parcela mais antiga em aberto:
  - taxa fixa: juros do contrato ÷ 30 por dia;
  - demais modalidades: saldo × taxa mensal ÷ 30 por dia.
  - Dá para dispensar a multa ao receber.

## Documentos e acordo
- Cada cliente guarda contratos, recibos e fotos (PDF ou imagem, até 10 MB) numa pasta privada do Supabase Storage.
- Cada crédito gera um acordo em PDF com as condições, as parcelas e os termos definidos em Mais › Dados do acordo. Os termos são um modelo de referência e devem ser revisados por um advogado.

## Testes
- Interface (demonstração, celular e computador): `python -m http.server 8765` nesta pasta e, em outro terminal, `node testes/teste_demo.js <pasta_das_fotos>`.
- Regras do banco (isolamento entre contas, convites, pagamento, modo leitura, documentos): `npm i @electric-sql/pglite` e `node testes/teste_banco.mjs supabase/schema.sql supabase/atualizacao_01.sql` (46 verificações).
- Cálculos (domingo, taxa fixa, multa, pagamento parcial): `node testes/teste_calc.mjs` (23 verificações).

## Custos e limites
- GitHub Pages: grátis.
- Supabase grátis: 500 MB de banco e até 50 mil usuários, mas **o projeto pausa depois de 7 dias sem uso** e não tem backup automático. Com clientes pagantes, use o plano Pro (US$ 25/mês), que não pausa e tem backup diário.
- O e-mail de confirmação do Supabase grátis tem limite baixo por hora. Com muitas vendas, configure um SMTP próprio (Authentication › Emails › SMTP).

## Próximos passos possíveis
- Pix com confirmação automática (Asaas, Efí ou Mercado Pago), com uma Edge Function do Supabase recebendo o aviso de pagamento e chamando a mesma liberação que o botão Confirmar.
- Termos de uso e política de privacidade (LGPD): o sistema guarda dados de terceiros (os clientes dos investidores).
