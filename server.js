/**
 * FIO Oracle
*/
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const bodyParser = require('body-parser');
import conf from './config/config';
import mainCtrl from './controller/main';
//const cors = require('cors')
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
//app.use(cors())

http.listen(conf.port, () => {
    console.log('server listening on *:'+conf.port);
});

mainCtrl.start(app).catch(console.error);
