const fs = require("fs");

const storagePath = "storage.json";

const cb = (error, response) => console.log(error, response);
const ctx = {
  data: process.env,
  storage: {
    get: (cb) => {
      try {
        const contents = fs.readFileSync(storagePath).toString();
        return cb(null, JSON.parse(contents));
      } catch (e) {
        return cb(null, {});
      }
    },
    set: (data, cb) => {
      fs.writeFileSync(storagePath, JSON.stringify(data));
      cb();
    },
  },
};

module.exports = (f) => f(ctx, cb);
