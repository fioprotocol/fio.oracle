const express = require('express')
const app = express();
const bodyParser = require('body-parser')
const { curly } = require('node-libcurl')
const route = require("express").Router();
import conf from './config/config';
app.use(
  express.urlencoded({
    extended: true
  })
)

app.use(express.json())
app.use(bodyParser.json())
// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: false }));

route.post("/getAccount", (req, res) => {
  // res.send(data)
  curly.post(process.env.SERVER_URL_HISTORY+'v1/history/get_actions', {
    postFields: JSON.stringify({ "account_name": req.body.account_name, "pos": req.body.pos}),
    httpHeader: [
      'Content-Type: application/x-www-form-urlencoded',
    ],
  })
  .then((response)=>{
    //   console.log(response)
      res.send(response);
  })
});
app.use(route);
app.listen(conf.port, () => {
  console.log(`server listening on *: ${conf.port}`)
});