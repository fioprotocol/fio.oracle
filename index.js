const express = require('express')

const app = express();
const port = 8000;
const { curly } = require('node-libcurl')
app.get('/', (req, res) => {
  // res.send(data)
  console.log(req.body);
  curly.post(process.env.SERVER_URL_HISTORY+'v1/history/get_actions', {
    postFields: JSON.stringify({ "account_name": req.body.account_name, "pos": req.body.pos }),
    httpHeader: [
      'Content-Type: application/json',
      'Accept: application/json'
    ],
  })
  .then((response)=>{
    res.send(response);
  })
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}!`)
});