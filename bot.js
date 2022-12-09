const {TwitterApi, ETwitterStreamEvent} = require("twitter-api-v2");
const TelegramBot = require('node-telegram-bot-api');
const http = require('https'); 
const fs = require('fs');
const path = require( "path" );
const dotenv = require('dotenv').config();


const token = process.env.Telegram_BotToken;
const channelId = process.env.Telegram_ChatID;

const bot = new TelegramBot(token, {polling: true});
const client = new TwitterApi({
  appKey: process.env.Twitter_AppKey,
  appSecret: process.env.Twitter_AppSecret,
  accessToken: process.env.Twitter_AccessToken,
  accessSecret: process.env.Twitter_AccessSecret,
});


function decodeEntities(encodedString) {
  var translate_re = /&(nbsp|amp|quot|lt|gt);/g;
  var translate = {
      "nbsp":" ",
      "amp" : "&",
      "quot": "\"",
      "lt"  : "<",
      "gt"  : ">"
  };
  return encodedString.replace(translate_re, function(match, entity) {
      return translate[entity];
  }).replace(/&#(\d+);/gi, function(match, numStr) {
      var num = parseInt(numStr, 10);
      return String.fromCharCode(num);
  });
}

async function streamTweets() {
  const streamer = await client.appLogin();
  
  try {
    const addedRules = await streamer.v2.updateStreamRules({
      add: [
        { value: 'from:carromero_123 -is:reply -is:retweet' }, // @elonmusk
      ],
    });

    params = {
      "expansions": ['author_id', 'attachments.media_keys'],
      "media.fields": ['url', 'variants'],
      "tweet.fields": ['attachments','author_id','conversation_id','created_at','entities','id','in_reply_to_user_id','lang', 'public_metrics', 'source', 'reply_settings'],
      "user.fields": ['created_at','description','entities','id','location','name','pinned_tweet_id','profile_image_url','protected','public_metrics','url','username','verified','withheld'],
    }
    
    const stream = await streamer.v2.searchStream(params);
    stream.autoReconnect = true;
    stream.autoReconnectRetries = Infinity;

    stream.on(ETwitterStreamEvent.Data, async (tweet) => {
      let tweetText = tweet.data.text;
      tweetText = decodeEntities(tweetText);

      // Telegram
      // extract media links
      mediaUrls = [];
      if (Object.getOwnPropertyNames(tweet.includes).includes('media')) {
        media = tweet.includes.media;
        media.forEach((media) => {
          if (media.type == 'photo') {
            mediaUrls.push(media.url);
          }
          else {
            let url = '';
            let maxBitrate = 0;
            media.variants.forEach((variant) => {
              if (!Object.getOwnPropertyNames(variant).includes('bit_rate')) return;
              if (variant.bit_rate > maxBitrate) {
                maxBitrate = variant.bit_rate;
                url = variant.url;
              }
            });
            if (url.length > 0) mediaUrls.push(url);
          }
        })
      }

      // download media
      let count = 0;
      for (let url of mediaUrls) {
        url = url.split('?')[0];
        ext = url.split('.').pop();
        
        const file = fs.createWriteStream(`./media/${count}.${ext}`);
        count++;

        await (async () => {
          return new Promise(resolve => {
            http.get(url, async function(response) {
              response.pipe(file);
              
              // after download completed close filestream
              file.on("finish", async () => {
                file.close();
                // console.log("Download Completed");
                resolve();
              });
            });
          });
        })()
      }

      // post tweet with media to telegram
      const folder = './media';
      let files = [];
      fs.readdirSync( folder ).forEach( file => {
        const extname = path.extname( file );
        const filename = path.basename( file, extname );
        files.push(`./media/${filename}${extname}`);
      });
      
      let mediaGroup = [];
      for (let file of files) {
        if (file.split('.')[2] == 'jpg') mediaGroup.push({type: 'photo', media: file});
        else if (file.split('.')[2] == 'mp4') mediaGroup.push({type: 'video', media: file});
      }

      if (mediaGroup.length > 0) {
        mediaGroup[0].caption = tweetText;
        await bot.sendMediaGroup(channelId, mediaGroup)
      }
      else {
        await bot.sendMessage(channelId, tweetText);
      }

      // delete file after sending
      for (let file of files) {
        fs.unlinkSync(file);
      }

    });

  }
  catch(e) {
    console.log(e);
  }
}


streamTweets();
