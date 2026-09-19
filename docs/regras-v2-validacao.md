# Eleição de oficiais IPB - regras v2 para validação

**Status:** regras implementadas, aguardando validação funcional
**Data:** 15 de setembro de 2026
**Substitui, para fins de validação, os documentos anteriores.** Eles permanecem apenas como histórico e referência técnica.

## 1. Objetivo

Realizar presencialmente a eleição de presbíteros e diáconos, com voto secreto pelo celular, alternativa em papel e controle integral pela mesa da assembleia.

Não haverá importação, cadastro ou consulta ao rol de membros. A conferência de quem pode votar e de quem pode ser indicado ocorrerá fora da plataforma, sob responsabilidade do Conselho e da mesa.

## 2. Preparação da eleição

Ao criar uma eleição, o administrador informará:

- igreja e data;
- quantidade de presbíteros e de diáconos a eleger;
- nomes dos indicados pelo Conselho para cada cargo;
- quantidade estimada de votantes e de senhas a gerar.

Somente os indicados cadastrados poderão aparecer na cédula e receber votos. Não haverá busca, inclusão de outro membro pelo votante ou candidatura fora dessa lista.

Se a quantidade de vagas de um cargo for zero, esse cargo será ignorado. Havendo vagas nos dois cargos, a eleição será organizada em duas votações separadas e sequenciais:

1. votação de presbíteros, com até três escrutínios, se necessários;
2. votação de diáconos, iniciada somente depois da conclusão da votação de presbíteros, também com até três escrutínios, se necessários.

A mesma senha continuará válida nas duas votações.

O sistema gerará senhas anônimas e únicas em um PDF compacto, com várias fichas por folha e linhas de corte. A quantidade gerada representa apenas a capacidade prevista, não o número real de presentes.

Será possível gerar novos lotes de senhas antes ou durante a eleição. Cada geração acrescentará senhas novas e não alterará nem invalidará as anteriores. O PDF de um novo lote trará somente as senhas recém-geradas, para evitar reimpressão e distribuição duplicada.

Depois de abrir a eleição e antes de iniciar o primeiro escrutínio, a mesa informará o número real de membros presentes. Esse número será a base de maioria de todos os escrutínios da eleição.

## 3. Acesso do votante

- Cada pessoa recebe uma senha sem vínculo com seu nome.
- A mesma senha vale durante toda a eleição e permite um voto em cada escrutínio aberto.
- Depois de votar em um escrutínio, a senha não poderá votar novamente naquela rodada.
- Digitar a senha não criará uma sessão persistente: ela autorizará somente o acesso à votação aberta naquele momento.
- A última senha digitada ficará salva no `localStorage` e aparecerá preenchida no próximo acesso. Ela poderá ser substituída normalmente quando outra pessoa usar o mesmo telefone; sempre ficará salva a senha usada mais recentemente.

### Fluxo de cada voto

1. A pessoa abre a página inicial, confere ou digita sua senha e toca em **Iniciar votação**.
2. O sistema consulta qual escrutínio está aberto e se aquela senha ainda pode votar nele.
3. Se puder, mostra diretamente a cédula correspondente.
4. Depois da confirmação e da gravação, mostra **Seu voto foi computado**.
5. Ao tocar em **Voltar ao início**, retorna à tela de senha, já preenchida com a última senha usada.

Não haverá uma página autenticada aguardando atualização em tempo real. A abertura de cada votação será comunicada no plenário, e o votante entrará novamente pela tela de senha.

Se a senha já tiver votado no escrutínio aberto, a tela informará **Seu voto já foi computado nesta votação** e permitirá voltar ao início. Se não houver escrutínio aberto, informará apenas que não há votação disponível naquele momento.

Esse fluxo permite que várias pessoas votem no mesmo aparelho sem ação de logout.

## 4. Regra da cédula

Em cada escrutínio, o votante poderá escolher **no máximo o número de vagas ainda não preenchidas**.

Exemplo: a eleição possui duas vagas. Se uma pessoa for eleita no primeiro escrutínio, no segundo cada votante poderá escolher no máximo um candidato.

O votante poderá escolher menos candidatos ou nenhum. Cada espaço não preenchido será registrado como um voto em branco. Assim, numa rodada com duas vagas restantes:

- dois candidatos selecionados = dois votos nominais e nenhum branco;
- um candidato selecionado = um voto nominal e um voto em branco;
- nenhum candidato selecionado = dois votos em branco.

Antes do envio, sempre haverá uma tela de confirmação mostrando os nomes escolhidos e a quantidade de votos em branco. Exemplos:

- "Você está votando em 2 candidatos para presbítero."
- "Você está votando em 1 candidato para presbítero e deixando 1 voto em branco."
- "Você está deixando 2 votos em branco para presbítero."

Somente uma nova confirmação enviará o voto. Até esse momento, o votante poderá voltar e alterar suas escolhas. Depois do envio, o voto não poderá ser alterado.

Após o envio, a tela exibirá **Seu voto foi computado** somente depois que o backend confirmar que o voto foi gravado. Se houver instabilidade durante o envio, a interface verificará silenciosamente se o voto foi recebido e impedirá reenvios duplicados enquanto faz essa conferência.

Quem já tiver sido eleito sai das cédulas seguintes.

## 5. Três escrutínios

Cada uma das duas votações terá seu próprio ciclo de até três escrutínios. Primeiro será concluído todo o ciclo dos presbíteros; depois começará o dos diáconos. Cada etapa continuará dependendo da abertura manual pela mesa.

### Primeiro escrutínio

- Concorrem todos os indicados pelo Conselho.
- Cada votante escolhe até o número total de vagas.
- É eleito quem alcançar a maioria exigida, calculada sobre os membros presentes, e estiver dentro das vagas disponíveis.

### Segundo escrutínio

- Ocorre somente se ainda houver vaga.
- Concorrem os indicados ainda não eleitos.
- A quantidade máxima de escolhas é igual às vagas restantes.
- Quem superar 50% e estiver dentro das vagas disponíveis é eleito.

### Terceiro escrutínio

- Ocorre somente se ainda houver vaga após o segundo.
- Concorrem somente os candidatos mais votados no segundo escrutínio, excluídos os já eleitos.
- O limite será de **dois candidatos por vaga restante**: uma vaga leva os dois mais votados; duas vagas levam os quatro mais votados; e assim por diante.
- Cada votante continuará podendo escolher no máximo o número de vagas restantes.
- O mesmo critério de maioria será aplicado.
- O sistema não presumirá que necessariamente haverá eleito: é possível terminar o terceiro escrutínio sem alguém superar 50%.

Em todos os escrutínios, a mesa encerra a votação, lança os votos em papel, confere a apuração, aprova e só então publica o resultado. Não haverá divulgação de parciais por candidato enquanto a votação estiver aberta.

### Cálculo da maioria

A maioria exigida será sempre calculada sobre o número de membros presentes informado pela mesa:

`maioria exigida = parte inteira de (presentes / 2) + 1`

Exemplos: 100 presentes exigem 51 votos; 187 presentes exigem 94 votos. Votos em branco, votos anulados e pessoas presentes que não votarem não reduzem essa maioria.

## 6. Voto em papel

O voto em papel permanece como contingência para quem não conseguir usar o celular.

- A cédula terá a mesma lista e o mesmo limite da cédula digital.
- Após o encerramento da votação digital, a mesa lançará manualmente cada cédula no sistema.
- Os lançamentos poderão ser revisados antes da confirmação do bloco.
- Uma pessoa não poderá votar por senha e também por papel. Se já tiver recebido senha e precisar migrar para papel, a senha deverá ser invalidada antes do lançamento da cédula.

## 7. Painel da mesa

O administrador poderá:

- criar e revisar a eleição, as vagas e os indicados;
- gerar lotes adicionais de senhas e imprimir separadamente cada lote;
- abrir a eleição e, antes do primeiro escrutínio, informar o número de membros presentes;
- abrir e encerrar cada escrutínio;
- acompanhar apenas a quantidade de votos recebidos;
- lançar e revisar votos em papel;
- conferir, aprovar e publicar o resultado;
- iniciar o escrutínio seguinte ou encerrar a eleição;
- consultar o histórico das ações e gerar o resumo para a ata.

## 8. Controles mínimos

- voto secreto: a plataforma não associa senha a pessoa;
- uma participação por senha em cada escrutínio;
- bloqueio de votos fora do período aberto;
- bloqueio de escolhas acima do limite;
- registro das ações administrativas;
- resultado por candidato, incluindo quem recebeu zero voto;
- interface simples, responsiva e sem aplicativo para instalar.

## 9. Conferência com o Manual Presbiteriano

Conferência feita na edição oficial de 2025.

- **CI/IPB, arts. 110 e 111:** a assembleia elege; o Conselho define o número de oficiais, pode sugerir nomes e baixa as instruções do pleito.
- **CI/IPB, art. 112:** cabe ao Conselho e à mesa garantir, fora da plataforma, que votantes e indicados sejam membros em plena comunhão e atendam aos requisitos aplicáveis.
- **CE-2019, DOC. XCIX:** admite cédulas com nomes impressos.
- **Modelo de Estatuto, art. 21:** exige mais de 50%, admite mais de um escrutínio, permite limitar aos mais votados depois do segundo e admite assembleia eletrônica ou híbrida com sigilo do voto.
- **SC-1954, DOC. CVIII:** recomenda eleição por escrutínio secreto.

**Atenção normativa:** o Manual fala que o Conselho pode *sugerir* nomes e autoriza expressamente a limitação aos mais votados depois do segundo escrutínio. Ele não declara de forma expressa que, desde o primeiro, somente os nomes sugeridos podem receber votos. A lista fechada deve, portanto, constar claramente nas instruções formais do Conselho; se houver dúvida eclesiástica local, convém validá-la antes da implementação.

## 10. Infraestrutura definida

- **Frontend:** React/Vite estático no Cloudflare Pages.
- **Backend:** API NestJS em contêiner Docker no CapRover.
- **Banco:** PostgreSQL do Supabase, acessado exclusivamente pelo backend por conexão PostgreSQL normal em `DATABASE_URL`.
- **Dados:** não será usada a API de dados, o Realtime nem as Edge Functions do Supabase. O frontend acessará os dados somente pela API própria.
- **Login administrativo:** Supabase Auth. O frontend obtém a sessão e a API valida o token; somente administradores terão conta.
- **Votantes:** as senhas anônimas serão validadas pela API própria a cada votação e não criarão usuários nem sessões persistentes no Supabase Auth.
- **Storage:** Supabase Storage somente se surgir necessidade. A princípio, o PDF de senhas pode ser gerado sob demanda, sem armazenamento permanente.
- **Publicação:** mesmo padrão dos projetos existentes: frontend por GitHub Actions/Direct Upload no Cloudflare Pages e imagem Docker do backend publicada e implantada no CapRover.

## 11. Identidade visual e usabilidade

A interface seguirá o Manual de Identidade Visual oficial da IPB:

- usar os arquivos oficiais da marca, sem redesenhar a sarça ou a tipologia;
- preservar proporção, composição e área livre mínima de 15% ao redor da marca;
- não rotacionar, distorcer, rearranjar, contornar, aplicar efeitos ou trocar as cores da marca;
- aplicar a marca colorida sobre fundo claro e as versões preta ou branca conforme o contraste do fundo;
- usar como cores institucionais o verde Pantone 350 C e o cinza institucional. Para a interface web, as referências extraídas do PDF oficial são verde `#00311D` e cinza `#4D4D4D`;
- manter Zapf Humanist na marca e em comunicações solenes, quando a fonte oficial estiver licenciada e disponível; para os demais textos, seguir a recomendação do manual com Times New Roman e alternativas serifadas compatíveis.

Para maximizar a facilidade de uso no celular:

- desenho mobile-first, com texto de pelo menos 16 px e áreas de toque de pelo menos 44 px;
- contraste acessível, poucos elementos por tela e uma única ação principal em destaque;
- candidatos apresentados como opções grandes, com seleção inequívoca;
- linguagem simples, sem termos técnicos ou mensagens de instabilidade de rede;
- confirmação mostrando nomes escolhidos e quantidade de votos em branco;
- estado de envio que impeça toques repetidos;
- sucesso claro somente após confirmação do backend, seguido do botão **Voltar ao início**.

## 12. Decisões confirmadas

- No empate do corte para os finalistas do terceiro escrutínio, a mesa escolhe quem seguirá; a decisão fica no histórico.
- Cada cargo terá no máximo três escrutínios. Se restar vaga sem candidato com maioria, a vaga permanece aberta.
- Se mais candidatos alcançarem a maioria do que houver vagas, serão confirmados os mais votados que estiverem inequivocamente acima da linha de corte. Havendo empate nessa linha, nenhum dos empatados ocupará a vaga naquele escrutínio; todos permanecerão elegíveis para disputar as vagas abertas no escrutínio seguinte. No terceiro escrutínio, eventual vaga ainda empatada permanecerá aberta. Essa proteção é necessária porque, quando cada cédula admite várias escolhas, mais candidatos do que vagas podem alcançar a maioria.
