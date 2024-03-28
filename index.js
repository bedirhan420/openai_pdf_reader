const { Client, Intents, MessageAttachment } = require("discord.js");
const { SlashCommandBuilder, EmbedBuilder } = require("@discordjs/builders");
const { config } = require("dotenv");
const OpenAI = require("openai");
const Book = require("./Book");
const fs = require("fs");
const axios = require("axios");

var books = [];
let assistantId;
var assistant;
let threadId;
let existing_file_ids = [];

fs.readFile("books.json", "utf8", (err, data) => {
  if (err) {
    console.error("Dosya okuma hatası:", err);
    return;
  }

  try {
    books = JSON.parse(data);
    // console.log("Dosyadan okunan veriler:");
    // console.log(books);
  } catch (error) {
    console.error("JSON verilerini ayrıştırma hatası:", error);
  }
});

fs.readFile("existingFileIDs.txt", "utf8", (err, data) => {
  if (err) {
    console.error("Dosya okuma hatası:", err);
    return;
  }

  existing_file_ids = data.trim().split("\n");
});

// fs.readFile("threadId.txt", "utf8", (err, data) => {
//   if (err) {
//     console.error("Dosya okuma hatası:", err);
//     return;
//   }
//   threadId = data.trim();
// });



config();

const client = new Client({
  intents: ["Guilds", "GuildMembers", "GuildMessages", "MessageContent"],
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

client.once("ready", async () => {
  console.log("The bot is online");

  const list = await openai.files.list();

  for await (const file of list) {
    //console.log(file);
  }
  
  
  // if (!threadId) {
  //   const thread = await openai.beta.threads.create();
  //   threadId = thread.id;
  //   fs.writeFileSync("threadId.txt",threadId)
  //   console.log("New thread created with ID:", threadId);
  // }

  const uploadSlash = new SlashCommandBuilder()
    .setName("upload")
    .setDescription("Upload a pdf")
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription("PDF file to upload")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("name").setDescription("input name").setRequired(true)
    );

  const askSlash = new SlashCommandBuilder()
    .setName("ask")
    .setDescription("ask a question")
    .addStringOption((option) =>
    option
      .setName("name")
      .setDescription("input a name")
      .setRequired(true)
      .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("input your question ")
        .setRequired(true)
    )
    ;

  client.application.commands
    .create(uploadSlash.toJSON())
    .then(() => console.log("Upload slash command registered"))
    .catch(console.error);

  client.application.commands
    .create(askSlash.toJSON())
    .then(() => console.log("Ask slash command registered"))
    .catch(console.error);
});

client.on("interactionCreate", async (interaction) => {
  if (!(interaction.isCommand() || interaction.isAutocomplete())) return;

  const { commandName, options } = interaction;

  if (interaction.isAutocomplete()) {
    if (commandName === "ask") {
      const focusedOption = options.getFocused();

      let choices = [];
      books.forEach(book=>choices.push(book.name))
      
      const filtered = choices.filter((choice) => {
        const normalizedChoice = choice.trim().toLowerCase();
        const normalizedFocusedOption = focusedOption.trim().toLowerCase();
        return normalizedChoice.startsWith(normalizedFocusedOption);
      });

      const responseChoices = filtered
        .slice(0, 25) 
        .map((choice) => ({ name: choice, value: choice }));

      await interaction.respond(responseChoices, { ephemeral: true });
    }
  }
  if (commandName === "upload") {
    await uploadHandler(interaction, options);
  }
  if (commandName == "ask") {
    await askQuestionHandler(interaction, options);
  }
});

const uploadHandler = async (interaction, options) => {

  
  const file = options.getAttachment("file");
  const name = options.getString("name");

await interaction.deferReply({ ephemeral: true });

if (!file) {
    await interaction.editReply({
        content: "Bir dosya ekleyin!",
        ephemeral: true,
    });
    return;
}

if (file.contentType.split("/")[1] !== "pdf") {
    await interaction.editReply({
        content: "PDF formatında bir dosya yükleyin!",
        ephemeral: true,
    });
    return;
}

if (books.some(book => book.name.toLowerCase() === name.toLowerCase())) {
    await interaction.editReply({
        content: "Lütfen farklı bir isim girin!",
        ephemeral: true,
    });
    return;
}


  console.log("PDF is being uploaded to OpenAI...");
  try {
    var openAiFile = await uploadFileFromURL(file.url);
    console.log("Uploaded file:", openAiFile);
  } catch (error) {
    console.error("Error uploading file to OpenAI:", error);
    return;
  }

  try {
    console.log(
      "Asistan güncellenmeye çalışılıyor, dosya ID'leri:",
      openAiFile.id
    );
    await createOrUpdateAssistant(openAiFile);
    console.log(`ASSSISTANT ID : ${assistantId} `);
    console.log("Dosya ID'leri başarıyla güncellendi.");
  } catch (error) {
    console.error("Dosya ID'leri güncelleme hatası:", error);
    return;
  }

  existing_file_ids.push(openAiFile.id);
  fs.writeFileSync("existingFileIDs.txt", existing_file_ids.join("\n"));
  
  const thread = await openai.beta.threads.create();


  const book = new Book(thread.id,name,openAiFile.id);
  books.push(book);
  saveToJsonFile(books, "books.json");

  await interaction.editReply({
    content: `PDF uploaded successfully. : ${file.name}`,
    ephemeral: true,
  });
};

const askQuestionHandler = async (interaction, options) => {
  const name = options.getString("name");
  const question = options.getString("question");

  await interaction.deferReply({ ephemeral: true });

  let matchedBook = books.find(book => book.name.toLowerCase() === name.toLowerCase());

  if (!matchedBook) {
    await interaction.editReply({ content: `There is any book with the name "${name}" `, ephemeral: true });
    return;
  } 
    
  console.log("threadId atanıyor")
  threadId = matchedBook.threadId;
  console.log( `threadID : ${threadId}`)
  

  var response = await answerQuestion(question,threadId);

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("ANSWER !")
    .setDescription(response)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], ephemeral: true });
};

const uploadFileFromURL = async (url) => {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
    });

    await fs.promises.writeFile("downloaded_file.pdf", response.data);

    const uploadResponse = await openai.files.create({
      file: fs.createReadStream("downloaded_file.pdf"),
      purpose: "assistants",
    });

    return uploadResponse;
  } catch (error) {
    console.error("Dosya yükleme hatası:", error);
  }
};


const createAssistant = async () => {
  const response = await openai.beta.assistants.create({
    instructions:"Yüklenen dosyalardaki konularla ilgili sorulara cevap verin. Dosyalarda bulunmayan konularla ilgili sorulara cevap vermeyin.",
    model: "gpt-4-1106-preview",
    tools: [{ type: "retrieval" }],
  });
  return response;
};

fs.readFile("assistant_id.txt", "utf8", (err, data) => {
  if (!err) {
    assistantId = data.trim();
  }
});

const createOrUpdateAssistant = async (openAiFile) => {
  if (assistantId) {
    await openai.beta.assistants.update(assistantId, {
      file_ids: [openAiFile.id],
    });
    console.log("Assistant updated:", assistant);
  } else {
    assistant = await createAssistant();
    console.log("Assistant created:", assistant);
    fs.writeFileSync("assistant_id.txt", assistant.id);
    assistantId = assistant.id;
  }
};

const answerQuestion = async (question,threadId) => {
  let answer;
  const message = await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: question,
  });
  
  const url = `https://api.openai.com/v1/threads/${threadId}/runs`;

  let run ;

  await axios.post(url, {
    assistant_id: assistantId
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v1'
    }
  })
  .then(response => {
    console.log('Başarılı istek:');
    run = response.data;

    console.log(run);
  })
  .catch(error => {
    console.error('Hata oluştu:', error);
  });

  console.log("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

  let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);

  while (runStatus.status !== "completed") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
  }

  if (["failed", "cancelled", "expired"].includes(runStatus.status)) {
    console.log(
      `Run status is ${runStatus.status}. Unable to complete the request`
    );
    return;
  }

  const messages = await openai.beta.threads.messages.list(threadId);

  const lastMessageForRun = messages.data
    .filter(
      (message) => message.run_id === run.id && message.role === "assistant"
    )
    .pop();

  if (lastMessageForRun) {
    console.log(`${lastMessageForRun.content[0].text.value} \n`);
    answer = lastMessageForRun.content[0].text.value;
  } else if (!["failed", "cancelled", "expired"].includes(runStatus.status)) {
    console.log("No response received from the assistant. ");
  }

  return answer;
};

const saveToJsonFile = (books, filename) => {
  const data = JSON.stringify(books, null, 2);
  fs.writeFileSync(filename, data);
  console.log(`Veriler başarıyla "${filename}" dosyasına kaydedildi.`);
};

client.login(process.env.BOT_TOKEN);
