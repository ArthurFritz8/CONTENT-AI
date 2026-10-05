import { storyContextSchema, type StoryDraft } from "../stories/schema.ts";
export function storyFixture(kind: "original" | "fruits" = "fruits") {
  const context = storyContextSchema.parse({ series_id: "55555555-5555-4555-8555-555555555555", chapter_number: 1, previous_summaries: [],
    bible: { title: "O segredo da pequena feira", kind, genre: "mystery", premise: "Dois amigos encontram uma chave na feira e descobrem quem estava escondendo o segredo da velha barraca.",
      cast: [{id:"lia",name:"Lia",appearance:kind==="fruits" ? "apple" : "human",color:"#e05f62",personality:"Curiosa e cuidadosa, sempre pensa antes de agir.",voice:"female"},
        {id:"rui",name:"Rui",appearance:kind==="fruits" ? "orange" : "robot",color:"#edb74d",personality:"Impulsivo e bem-humorado, aprende a ouvir sua amiga.",voice:"male"}],
      chapters: [{title:"Uma chave misteriosa",arc:"Os dois amigos encontram uma chave, discutem sobre a porta que ela abre e descobrem a primeira pista."},
        {title:"A porta da verdade",arc:"Seguindo a pista, os amigos abrem a porta e encontram a carta que explica o segredo da velha barraca."}] } });
  const texts = [
    "Lia encontrou uma chave dourada debaixo da barraca, mas Rui jurou que ela tinha aparecido ali durante a noite. Os dois olharam para a porta fechada ao fundo da feira. Ninguém lembrava de ter visto aquela porta aberta antes.",
    "Rui quis testar a chave imediatamente. Lia pediu que esperassem e procurassem quem poderia ter perdido aquilo. Ele concordou, embora não escondesse a curiosidade. Enquanto caminhavam pelo jardim, perceberam uma pequena fita azul presa ao metal, com duas letras bordadas.",
    "A fita não estava ali por acaso. Lia reconheceu o mesmo desenho numa caixa guardada no escritório da barraca. Quando os amigos voltaram, encontraram a caixa vazia e uma marca redonda na poeira. Alguém havia levado o objeto naquela manhã.",
    "Rui percebeu que não era uma simples chave perdida. Talvez alguém quisesse que eles a encontrassem. Pela primeira vez, ele decidiu ouvir a amiga antes de agir. Juntos, compararam as letras da fita com os nomes escritos nas antigas placas.",
    "No verso de uma placa, Lia descobriu uma frase: procure onde todos chegam, mas ninguém permanece. Rui olhou para o portão da feira. Atrás dele havia outra fechadura dourada. Os amigos tinham encontrado a primeira resposta, e agora precisavam decidir se abririam aquela porta.",
  ];
  const draft: StoryDraft = {title:"Uma chave mudou a feira",summary:"Lia e Rui encontram uma chave misteriosa e descobrem que a fita azul aponta para a fechadura escondida atrás do portão da feira. Eles ainda não abriram a porta.",scenes:texts.map((narration_text,i)=>({narration_text,visual:{speaker_id:"narrator",on_stage:["lia","rui"],setting:i%2 ? "garden" : "home",mood:i===0 ? "surprised" : "neutral"}}))};
  return {context,draft};
}
