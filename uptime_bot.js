const fetch = require('isomorphic-unfetch');

const fetchOptions = {
    timeout: 5000,
    redirect: 'manual',
};
const now = () => new Date().getTime();

const notify = (ctx, url, data, cb) => {
    const apiKey = ctx.data.MAILGUN_API_KEY;
    if (!apiKey) {
        return cb(Object.assign({}, data, { mailgunError: 'MAILGUN_API_KEY secret is missing!' }));
    }

    const domain = ctx.data.MAILGUN_DOMAIN;
    if (!apiKey) {
        return cb(Object.assign({}, data, { mailgunError: 'MAILGUN_DOMAIN secret is missing!' }));
    }

    const notifyAddress = ctx.data.NOTIFY_ADDRESS;
    if (!notifyAddress) {
        return cb(Object.assign({}, data, { mailgunError: 'NOTIFY_ADDRESS secret is missing!' }));
    }

    const mailgun = require('mailgun-js')({ apiKey, domain });
    const dataJson = JSON.stringify(data, null, 2);
    const mailData = {
        from: 'uptime-bot@' + domain,
        to: notifyAddress,
        subject: `Uptime Notification for ${url}`,
        text: `Hey!\n\nLook at latest fetch data for ${url}, it doesn't look good:\n\n${dataJson}`,

        'o:tracking': 'no',
    };
    return mailgun.messages().send(mailData, mailgunError => cb(Object.assign({}, data, { mailgunError })));
}

module.exports = function (ctx, cb) {
    const start = now();
    const url = ctx.data.TARGET_URL;

    const prepareData = data => Object.assign({ url, ellapsedInMs: now() - start }, data);
    const ok = data => cb(null, prepareData(data));
    const notOk = data => notify(ctx, url, prepareData(data), data2 => cb(null, data2));
    
    if (!url) {
        return notOk({ urlError: 'TARGET_URL secret is missing!' });
    }

    fetch(url, fetchOptions).then(
        r => r.text().then(
            (text) => {
                (r.ok ? ok : notOk)({
                    status: r.status,
                    textLength: text.length,
                });
            },
            parseError => notOk({ parseError })
        ),
        fetchError => notOk({ fetchError })
    );
};
