import dotenv from 'dotenv';
dotenv.config();
import app from './api/index.js';
const port = process.env.PORT || 3100;
app.listen(port, () => console.log(`nexumo-api local en puerto ${port}`));
