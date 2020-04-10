const Promise = require("bluebird");
const fetch = require("isomorphic-unfetch");
const _omit = require("lodash.omit");

const CONSECUTIVE_ERROR_COUNT_TO_NOTIFY = 2;
const FETCH_TIMEOUT = 10000;
const STORAGE_ATTEMPTS_MAX = 10;
const VERSION_ID = 2018100301;

const now = () => new Date().getTime();
const datetime = (ms) => new Date(ms).toUTCString();

const dataGet = (ctx) =>
  new Promise((resolve) => {
    ctx.storage.get((_, data) =>
      resolve(data && data.v === VERSION_ID ? data : {})
    );
  });

const dataSet = (ctx, data) =>
  new Promise((resolve) => {
    // TODO: handle conflict error.code = 409
    ctx.storage.set(data, () => resolve());
  });

const notify = (ctx, storageData, urlsData) => {
  let body = "";
  urlsData.forEach((d) => {
    const { url, error: urlFailed } = d;
    if (!urlFailed) {
      return;
    }

    let bodyChecks = "";
    let foundNonError = false;
    let consecutiveErrorCount = 0;
    const { latestUp, checks: originalChecks } = storageData[url];
    const latestUpStr = latestUp ? datetime(latestUp) : "Never";
    const checks = originalChecks.slice().reverse();
    checks.forEach((check) => {
      const { start, ms, error: checkFailed } = check;
      const startStr = datetime(start);

      if (checkFailed) {
        if (foundNonError === false) {
          consecutiveErrorCount++;
        }
      } else {
        foundNonError = true;
      }

      bodyChecks += `${startStr} ${checkFailed ? "❌" : "✅"} in ${ms}ms\n`;
    });

    if (consecutiveErrorCount < CONSECUTIVE_ERROR_COUNT_TO_NOTIFY) {
      return;
    }

    body += `${url}\nLatest up: ${latestUpStr}\n<pre>${bodyChecks}</pre>\n\n`;
  });

  if (body === "") {
    return Promise.resolve({ body, error: false, en: null });
  }

  return notifyTelegram(ctx, body);
};

const notifyTelegram = (ctx, body) => {
  const botToken = ctx.data.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Promise.reject("TELEGRAM_BOT_TOKEN secret is missing!");
  }

  const chatId = ctx.data.TELEGRAM_CHAT_ID;
  if (!chatId) {
    return Promise.reject("TELEGRAM_CHAT_ID secret is missing!");
  }

  const Slimbot = require("slimbot");
  const slimbot = new Slimbot(botToken);
  const options = {
    disable_web_page_preview: true,
    parse_mode: "HTML",
  };
  return slimbot.sendMessage(chatId, body, options).then(
    () => ({ body, error: false, en: null }),
    (en) => ({ body, error: true, en })
  );
};

const check = (url) => {
  const start = now();
  const stats = (data) =>
    Object.assign({ url, start, ms: now() - start }, data);
  return fetch(url, { timeout: FETCH_TIMEOUT, redirect: "manual" }).then(
    (response) =>
      response.text().then(
        (text) =>
          stats({
            error: !response.ok,
            status: response.status,
            length: text.length,
          }),
        (ep) => stats({ error: true, ep })
      ),
    (ef) => stats({ error: true, ef })
  );
};

const updateStorage = (ctx, dataOld, urlsData) => {
  const buildForUrl = (urlData) => {
    const { url, start, error } = urlData;
    const urlDataOld = dataOld[url] ? dataOld[url] : {};

    const latestUp = error
      ? urlDataOld.latestUp
        ? urlDataOld.latestUp
        : 0
      : start;

    let checks = urlDataOld.checks ? urlDataOld.checks : [];
    const checkData = _omit(urlData, ["url", "status", "length"]);
    checks.push(checkData);
    checks = checks.slice(Math.max(0, checks.length - STORAGE_ATTEMPTS_MAX));

    return { latestCheck: start, latestUp, checks };
  };

  const dataNew = { v: VERSION_ID };
  urlsData.forEach((d) => (dataNew[d.url] = buildForUrl(d)));

  return dataSet(ctx, dataNew).then(() => ({ storageData: dataNew, urlsData }));
};

module.exports = function (ctx, cb) {
  const startAll = now();

  const urls = ctx.data.UPTIME_BOT_URLS.split(",");
  const promises = urls.map(check);
  promises.push(dataGet(ctx));
  let p = Promise.all(promises);

  p = p.then((values) => {
    const storageData = values.pop();
    return { storageData, urlsData: values };
  });

  p = p.then(({ storageData, urlsData }) =>
    updateStorage(ctx, storageData, urlsData)
  );

  p = p.then((results) => {
    const { storageData, urlsData } = results;
    let needNotifying = false;
    urlsData.forEach((d) => (needNotifying = needNotifying || d.error));
    if (needNotifying) {
      return notify(ctx, storageData, urlsData)
        .catch((reason) => ({ error: true, catched: reason }))
        .then((notifyData) => Object.assign({ notifyData }, results));
    }

    return results;
  });

  p = p.then(({ notifyData, urlsData }) =>
    cb(null, { msTotal: now() - startAll, notifyData, urlsData })
  );

  return p;
};
