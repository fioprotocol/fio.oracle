const express = require('express')
const app = express();
const bodyParser = require('body-parser')
import conf from './config/config';
import mainCtrl from './controller/main';
app.use(
  express.urlencoded({
    extended: true
  })
)

app.use(express.json())
app.use(bodyParser.json())

app.listen(conf.port, () => {
  console.log(`server listening on *: ${conf.port}`)
});
mainCtrl.start(app).catch(console.error);
