const express = require('express');
const app = express();
const cors = require('cors');
const routes = require('./routes/api');

app.use(cors());
app.use(express.json());
app.use('/api', routes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
