# Aportes

Sistema para investidores cadastrarem clientes e aportes (valor, taxa, vencimentos) e verem quanto vão receber por dia e por mês. Funciona no celular (pode ser instalado na tela inicial) e no computador.

Vendido por assinatura mensal paga por Pix: cada investidor cria a própria conta, com os dados isolados dos demais.

- Página: arquivos estáticos (GitHub Pages).
- Banco e login: Supabase (Postgres com regras de acesso por linha).
- Demonstração sem cadastro: `?demo` no fim do endereço (dados de exemplo guardados só no navegador).

## Publicar (uma vez, cerca de 20 minutos)

### 1. Supabase (banco e login)
1. Em https://supabase.com, crie um projeto novo (separado do SAGA). Região: São Paulo.
2. **SQL Editor**: abra `supabase/schema.sql`, troque `SEU_EMAIL@EXEMPLO.COM` pelo seu e-mail e rode o arquivo inteiro.
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
1. Abra o endereço, toque em **Criar acesso** com o seu e-mail, confirme pelo e-mail recebido e entre.
2. Crie a sua conta de investidor.
3. Em **Mais › Painel do administrador**, preencha o preço, os dias de teste, a chave Pix, o nome do recebedor e a cidade.

## Como funciona a assinatura
- Quem cria uma conta ganha os dias de teste definidos no painel.
- Em **Mais › Assinatura**, o investidor escolhe 1, 3, 6 ou 12 meses, paga pelo QR Code (ou copia e cola) e toca em **Já paguei**.
- No **Painel do administrador** aparece o pagamento com o valor e o código de identificação (ex.: `APT7DA679197849`), que também vai no Pix. Confira no extrato e toque em **Confirmar**: os meses somam à validade.
- Assinatura vencida: a conta fica **só para leitura** (vê tudo, não grava), até o pagamento ser confirmado.
- O administrador vê contas e pagamentos, nunca os clientes e aportes dos investidores.

## Formas de recebimento de um aporte
| Opção | Exemplo |
|---|---|
| Pagamento único | R$ 10.000 a 2% a.m., capital e juros em 6 meses |
| Juros a cada período e capital no último | R$ 200 por mês e os R$ 10.000 na última parcela |
| Parcelas iguais (Price) | 12 parcelas de R$ 945,60 |
| Amortização constante (SAC) | parcelas decrescentes |
| Parcelas definidas por mim | datas e valores livres |

A frequência pode ser diária, semanal, quinzenal, mensal, bimestral, trimestral, semestral ou anual. A taxa pode ser ao mês ou ao ano, com juros simples ou compostos. Antes de gravar, dá para ajustar a data e o valor de cada parcela.

## Testes
- Interface (demonstração, celular e computador): `python -m http.server 8765` nesta pasta e, em outro terminal, `node testes/teste_demo.js <pasta_das_fotos>`.
- Regras do banco (isolamento entre contas, convites, pagamento, modo leitura): `npm i @electric-sql/pglite` e `node testes/teste_banco.mjs supabase/schema.sql` (31 verificações).

## Custos e limites
- GitHub Pages: grátis.
- Supabase grátis: 500 MB de banco e até 50 mil usuários, mas **o projeto pausa depois de 7 dias sem uso** e não tem backup automático. Com clientes pagantes, use o plano Pro (US$ 25/mês), que não pausa e tem backup diário.
- O e-mail de confirmação do Supabase grátis tem limite baixo por hora. Com muitas vendas, configure um SMTP próprio (Authentication › Emails › SMTP).

## Próximos passos possíveis
- Pix com confirmação automática (Asaas, Efí ou Mercado Pago), com uma Edge Function do Supabase recebendo o aviso de pagamento e chamando a mesma liberação que o botão Confirmar.
- Termos de uso e política de privacidade (LGPD): o sistema guarda dados de terceiros (os clientes dos investidores).
