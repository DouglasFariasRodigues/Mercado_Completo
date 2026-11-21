# Gestão de Mercado — Edição pública

Aplicativo desktop para Windows, executado em um único computador. Esta versão não oferece conexão com outros computadores nem inicia serviços de rede.

## Executar

1. Instale o Node.js LTS.
2. Execute `npm install`.
3. Execute `npm start`.

No primeiro acesso, crie o administrador e defina uma senha exclusiva com pelo menos 12 caracteres. Não há usuário ou senha padrão. As senhas são armazenadas como hashes PBKDF2 com salt aleatório.

## Dados e segurança

Os dados comerciais são mantidos localmente no perfil do aplicativo e não são criptografados por esta versão. Faça backups protegidos e controle o acesso à conta do Windows. Os perfis limitam as telas no uso normal, mas não garantem autorização contra quem controla o computador ou os arquivos locais.

## Gerar instalador

Execute `npm run dist`; o resultado ficará em `dist/`. Não envie instaladores, dados de clientes, credenciais, chaves ou certificados ao repositório.

Esta edição usa identidade visual genérica e não inclui os logotipos, ícones ou cores da versão comercial. Antes de publicar, revise também as licenças de dependências e o conteúdo do repositório.
