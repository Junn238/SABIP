import 'dotenv/config'
import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, doc, setDoc, getDoc, getDocs, writeBatch } from "firebase/firestore/lite";
// import { createServer } from "node:http"
import express from 'express';

// Configuracion Firebase
const firebaseConfig = {
  apiKey: process.env.API_KEY,
  authDomain: process.env.AUTH_DOMAIN,
  projectId: process.env.PROJECT_ID,
  storageBucket: process.env.STORAGE_BUCKET,
  messasingSenderId: process.env.MSSG_SENDER_ID,
  appId: process.env.APP_ID,
};

// Inicializacion de componentes necesarios
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const xpress = express();

// tests
// const userRef = collection(db, "users");
// const querySnap = await getDocs(userRef);
// querySnap.forEach((user) => {
//   const userData = user.data();
//   console.log(`${userData.biometric_id} - ${userData.name}`);
// })

// GET, POST, PUT, DELETE

xpress.use(express.json());

// Metodo POST para agregar usuarios
xpress.post('/api/users', async (req, res) => {
  const { biometric_id, route, name } = req.body;
  if (!biometric_id)
    return res.status(400).end();

  const new_user = {
    route,
    name
  };

  await setDoc(doc(db, "users", biometric_id), new_user);

  console.log(`Usuario ingresado correctamente: ${JSON.stringify(new_user)}`);
  return res.status(201).end();
});

// Metodo POST para agrega/actualizar registros de usuarios
xpress.post('/api/log', async (req, res) => {
  try {
    const userList = req.body;

    if (!userList || (Array.isArray(userList) && userList.length == 0))
      return res.status(400).end();

    // Si se envia una lista de usuarios para registrar
    if (Array.isArray(userList)) {
      const batch = writeBatch(db);

      for (const item of userList) {
        const {date, biometric_id, route} = item;

        if (!biometric_id)
          return res.status(400).end();

        const docRef = doc(db, "log", date);
        batch.set(docRef, { biometric_id, route });
        console.log(`Objeto registrado correctamente: ${JSON.stringify(item)}`);
      }

      await batch.commit();

      return res.status(201).end();
    } else {
      // Si se envia un solo usuario para registrar
      const {date, biometric_id, route } = userList;

      if (!biometric_id)
        return res.status(400).end();

      await setDoc(doc(db, "log", date), {
        biometric_id,
        route
      });

      console.log(`Objeto registrado correctamente: ${JSON.stringify(userList)}`);
      return res.status(201).end();
    }

  }
  catch (e) {
    console.error('Error al guardar lista de usuarios:', e);
    return res.status(500).end();
  }
});

// metodo GET para recuperar registros de usuarios
// Solo devuelve los valores necesarios (en este caso el nombre)
xpress.get('/api/users/id/:id', async (req, res) => {
  const u_id = req.params.id;
  const docRef = doc(db, "users", u_id);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists())
    return res.status(404).send('Unknown user');
  return res.send(docSnap.data().name)
});

// -----------------------------------------------
//             METODOS GET AUXILIARES
// (No necesarios para la comunicacion con Arduino)
// ------------------------------------------------

// metodo GET para recibir la lista total de usuarios
xpress.get('/api/users', async (req, res) => {
  const docSnap = await getDocs(collection(db, "users"));
  let users = [];

  if (docSnap.empty)
    return res.status(404).json({ error: "Lista de usuarios vacia" });
  docSnap.forEach((doc) => {
    users.push(doc.data());
  });
  res.json(users);
});

// metodo GET para recibir la lista de usuarios pertenecientes a x ruta
xpress.get('/api/users/route/:route', async (req, res) => {
  const route = req.params.route;
  const q = query(collection(db, "users"), where("route", "==", route));
  const docSnap = await getDocs(q);

  if (docSnap.empty)
    return res.status(404).json({error: "Ruta de usuarios vacia"});
  let users = [];
  docSnap.forEach((doc) => {
    users.push(doc.data());
  });
  res.json(users);
});

xpress.get('/home', async (req, res) => {
  const docSnap = await getDocs(collection(db, "users"));
  let users = [];

  if (docSnap.empty)
    return res.status(404).json({ error: "No users" });
  docSnap.forEach((doc) => {
    users.push(doc.data());
  });
  res.write(`
    <table>
      <caption>
        Usuarios del transporte administrado por el sistema SABIP
      </caption>
      <thead>
        <tr>
          <th scope="col">Nombre</th>
          <th scope="col">Ruta</th>
        </tr>
      </thead>
      <tbody>`);
  users.forEach((user) => {
    res.write(`
      <tr>
        <td>${user.name}</td>
        <td>${user.route}</td>
      </tr>
      `);
  })
  res.write(`
    </tbody>
    </table>
    `);
  res.end();
});

// configuracion del servidor
const hostname = '0.0.0.0';
const port = 8080;
xpress.listen(port, hostname, () => {
  console.log(`Servidor corriendo en http://${hostname}:${port}/`);
});
