#include <ArduinoJson.h>
#include <Wire.h>
#include <RTClib.h>
#include <WiFi.h>
#include <HTTPClient.h>
<<<<<<< HEAD
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <HardwareSerial.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_Fingerprint.h>

// --- Componentes ---
RTC_DS1307 rtc;
=======
>>>>>>> probando_web

// --- CONFIGURACIÓN DE PINES Y RED ---
#define RED_PIN 2
<<<<<<< HEAD

// --- MACROS auxiliares para la pila ---
#define STACK_SIZE 48
#define ST_ERROR   -1

// --- Configuración WiFi / HTTP ---
=======
#define BUZZER_PIN 4

// El SSID varia (obviamente)
>>>>>>> probando_web
const char* ssid = "INFINITUMB9B8";
const char* password = "g53kZGU5pS";
<<<<<<< HEAD
// Para el servidor puede variar la ip, pero el puerto siempre es el mismo
// El puerto para escuchar peticiones esta definido como 8080
// serverUrl = http://X.X.X.X:8080
const char* serverUrl = "http://192.168.1.76:8080";
=======
>>>>>>> probando_web

// --- URLS DEL SERVIDOR NODE.JS ---
// Usando la IP de tu servidor
const char* serverUrl = "http://192.168.1.76:8080/api/log"; 
const char* statusUrl = "http://192.168.1.76:8080/api/status"; 
const char* enrollUrl = "http://192.168.1.76:8080/api/enroll";

// El identificador de la ruta para este camión en específico
const String RUTA_ACTUAL = "ruta_1";

// --- VARIABLES DE CONTROL WEB ---
String modo_lectura = "abordaje"; // Estado por defecto
unsigned long ultimoChequeo = 0;
const unsigned long INTERVALO_CHEQUEO = 5000; // Consultar servidor cada 5 segundos

// --- COMPONENTES GLOBALES ---
RTC_DS3231 rtc; 

// --- ESTRUCTURA PARA ALMACENAR REGISTROS (OFFLINE) ---
struct Registro {
  String clave;
  String fecha;
};

#define STACK_SIZE 50
#define ST_ERROR -1
Registro USER_STACK[STACK_SIZE];
int STACK_POS = 0;

<<<<<<< HEAD
// --- variables globales y definiciones auxiliares ---
const String route = "ruta 32";
char bufferFecha[25];
#define REGISTER 0
#define NEW_USER 1
uint8_t choice;
=======
>>>>>>> probando_web


void setup() {
<<<<<<< HEAD
  Serial.begin(9600);
  pinMode(RED_PIN, OUTPUT);
  digitalWrite(RED_PIN, LOW);

  // Inicializar pantalla OLED
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println(F("SSD1306 allocation failed"));
    for (;;)
      ;
  }

  // Inicializar lector de huellas
  mySerial.begin(57600, SERIAL_8N1, 16, 17);
  finger.begin(57600);

  if (!finger.verifyPassword()) {
    display_text("Error sensor huella :c");
    for (;;)
      ;
  }

  // Codigo para restaurar base de datos del sensor
  // Usar con precaucion

  /*
    if (finger.emptyDatabase() != FINGERPRINT_OK)
      Serial.println("Error al formatear sensor");
  */

  // Inicializar RTC DS1307
  if (!rtc.begin()) {
    display_text("Error: DS3231 module not found");
    for (;;)
      ;
  } else if (!rtc.isrunning()) {
    display_text("RTC sad, idk");
    delay(5000);
    // Ajusta el RTC a la fecha y hora de compilación
  }

  // Codigo para ajustar los segundos entre
  // la compilacion y la escritura del codigo (compensar el desajuste del reloj)
  // no pregunte por el 14...

  /*
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  DateTime now = rtc.now();
  uint8_t adjust_second = now.second() + 14;
  uint8_t adjust_minute = now.minute();
  if (adjust_second > 59) {
    adjust_second = adjust_second % 60;
    adjust_minute++;
  }
  rtc.adjust(DateTime(
    now.year(), now.month(), now.day(),
    now.hour(), adjust_minute, adjust_second
  ));
  */

  // Intento opcional de conexión WiFi
  WiFi.begin(ssid, password);

  // Modo predeterminado del sistema (registro de usuarios)
  display.clearDisplay();
  display.setCursor(0,0);
  display.println("Seleccionar modo:");
  display.println("0. Registro asistencia");
  display.println("1. Nuevo usuario");
  choice = readnumber();
}

void loop() {

  switch(choice) {
    case REGISTER: { leer_serial(); break; }

    case NEW_USER: {    newUser(); break; }

    default: {
      display_text("Opcion invalida");
      delay(5000);
      break;
    }
  }

}

// --- Registro de datos para nuevo usuario ---
void newUser()
{
  int id = buscarIndice();
  if (id == -1)
    return;

  if (!registrarHuella(id))
    return;

  display_text("ID capturado");
  delay(1000);
  crearUsuarioHTTP(String(id));
}

// --- Generacion de usuario mediante HTTP POST ---
void crearUsuarioHTTP(String bio_id)
{
  if (WiFi.status() != WL_CONNECTED) {
    display_text("Error: no WiFi");
    delay(3000);
    return;
  }
  HTTPClient http;
  String url = String(serverUrl) + "/api/enroll";
  http.begin(url);
  http.addHeader("content-Type", "application/json");

  JsonDocument doc;
  doc["biometric_id"] = bio_id;

  String jsonPayload;
  serializeJson(doc, jsonPayload);
  int httpCode = http.POST(jsonPayload);

  if (httpCode == 201) {
    display_text("Huella enviada a\nvinculacion");
    activarAlarma();
  } else {
    Serial.printf("Error HTTP: %d", httpCode);
    display_text("Error de vinculacion");
  }
  delay(3000);
  http.end();
}

// --- Obtencion de datos mediante puerto Serial ---
void leer_serial(void)
{
  int id_encontrado = buscarHuella();

  if (id_encontrado == -1) {
    display_text("Huella invalida\nIntente de nuevo...");
    delay(2000);
    return;
  }

  process_log(String(id_encontrado));
}

// --- Procesamiento de asistencias de usuario / creacion de log ---
void process_log(String codigo)
{
=======
  Serial.begin(115200);
  pinMode(RED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(RED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  // Inicializar I2C y RTC DS3231
  if (!rtc.begin()) {
    Serial.println("Error: No se encontró el módulo RTC DS3231");
  } else if (!rtc.isrunning()) { // Ajustado a lostPower() si usas la libreria moderna, o isrunning() según tu código
    Serial.println("RTC perdió energía, configurando hora por defecto...");
    // Ajusta el RTC a la fecha y hora de compilación
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  // Intento de conexión WiFi
  WiFi.begin(ssid, password);
  Serial.println("Iniciando ESP32... Conectando a WiFi...");
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConectado a la red WiFi.");
}

void loop() {
  // 1. Consultar estado del servidor periódicamente sin bloquear el ESP32
  if (millis() - ultimoChequeo >= INTERVALO_CHEQUEO) {
    ultimoChequeo = millis();
    if (WiFi.status() == WL_CONNECTED) {
      consultarEstado();
    }
  }

  // 2. Leer entrada (Simulación por Serial actual o futuro sensor AS608)
  if (Serial.available() > 0) {
    String entradaSerial = Serial.readStringUntil('\n');
    entradaSerial.trim(); // Remover espacios o saltos de línea (\r, \n)
    
    if (entradaSerial.length() > 0) {
      if (modo_lectura == "abordaje") {
        // Modo normal: Registra el abordaje
        procesarLectura(entradaSerial);
      } 
      else if (modo_lectura == "nueva_huella") {
        // Modo registro: Enrola la nueva huella y avisa al backend
        enviarNuevaHuella(entradaSerial);
        // Retornamos de inmediato a modo normal localmente
        modo_lectura = "abordaje"; 
      }
    }
  }
}

// ----------------------------------------------------
// FUNCIONES DE CONTROL DE ABORDAJE (ORIGINALES)
// ----------------------------------------------------

void procesarLectura(String codigo) {
>>>>>>> probando_web
  String user_id = codigo;
  DateTime ahora = rtc.now();
  char bufferFecha[25];
  snprintf(bufferFecha, sizeof(bufferFecha), "%04d-%02d-%02d %02d:%02d:%02d",
           ahora.year(), ahora.month(), ahora.day(),
           ahora.hour(), ahora.minute(), ahora.second()
          );
          
  Registro registro_auxiliar = { user_id, String(bufferFecha) };

  if (WiFi.status() != WL_CONNECTED) {
    // Envia el registro formateado a la pila offline
    stack_push(registro_auxiliar);
  } else if (WiFi.status() == WL_CONNECTED) {
    // Intentar enviar petición HTTP POST con el registro actual y los de la pila
    enviarPeticionHTTP(registro_auxiliar);
  }
}

<<<<<<< HEAD
// --- Envío de Datos por HTTP POST ---
void enviarPeticionHTTP(Registro user)
{
=======
void enviarPeticionHTTP(Registro registro_actual) {
  int heap_index = 0;
>>>>>>> probando_web
  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  JsonArray arreglo = doc.to<JsonArray>();

  // 1. Añadimos el registro que acaba de suceder
  JsonObject current_user = arreglo.add<JsonObject>();
  current_user["biometric_id"] = registro_actual.clave; // Ajustado a biometric_id para el Node.js
  current_user["date"] = registro_actual.fecha;
  current_user["route"] = RUTA_ACTUAL; // Añadimos la ruta

  // 2. Vaciamos los registros almacenados en la pila
  while ((heap_index = stack_pop()) != ST_ERROR) {
    JsonObject user = arreglo.add<JsonObject>();
    user["biometric_id"] = USER_STACK[heap_index].clave;
    user["date"] = USER_STACK[heap_index].fecha;
    user["route"] = RUTA_ACTUAL;
  }

  String jsonPayload;
<<<<<<< HEAD
  bool isbatch = false;
  int stack_start = STACK_POS;
  int load = 0;

  if (STACK_POS > 0) {
    isbatch = true;
    JsonArray array = doc.to<JsonArray>();

    JsonObject arr_user = array.add<JsonObject>();
    arr_user["date"] = user.date;
    arr_user["biometric_id"] = user.biometric_id;
    arr_user["route"] = user.route;
    load++;

    int heap_index;
    while ((heap_index = stack_pop()) != ST_ERROR) {
      JsonObject stack_user = array.add<JsonObject>();
      stack_user["date"] = USER_STACK[heap_index].date;
      stack_user["biometric_id"] = USER_STACK[heap_index].biometric_id;
      stack_user["route"] = USER_STACK[heap_index].route;
      load++;
    }
  } else {
    doc["date"] = user.date;
    doc["biometric_id"] = user.biometric_id;
    doc["route"] = user.route;
  }

=======
>>>>>>> probando_web
  serializeJson(doc, jsonPayload);

  int httpResponseCode = http.POST(jsonPayload);

  if (httpResponseCode == 201) {
    Serial.println("Registros de abordaje enviados correctamente.");
    activarAlarma(); // Señal de éxito
  } else {
<<<<<<< HEAD
    Serial.printf("Error HTTP: %s:\n", http.errorToString(httpCode).c_str());
    display.println("Error con el servidor");
    display.println("Registro almacenado en stack");
    // revertir stack_pop realizados actualizando el indice
    STACK_POS = stack_start;
    // subir usuario al stack
    stack_push(user);

  }

  display.display();
  delay(3000);
  http.end();
}

// --- Obtencion de nombre de usuario por HTTP GET ---
String obtener_username(String biometric_id)
{
  if (WiFi.status() != WL_CONNECTED)
    return "No WiFi";

  HTTPClient http;
  String url = String(serverUrl) + "/api/users/id/" + biometric_id;
  http.begin(url);

  int httpCode = http.GET();
  String name = "NULL";

  if (httpCode == HTTP_CODE_OK || httpCode == 404)
    name = http.getString();
  else
    Serial.printf("Error en GET: %s\n", http.errorToString(httpCode).c_str());

  http.end();
  return name;
}

// --- Busqueda de espacio disponible en sensor ---
int buscarIndice()
{
  finger.getTemplateCount();

  if (finger.templateCount >= 127)
    return -1;

  return finger.templateCount + 1;
}

// --- Creacion de imagen de huella (sensor) ---
bool registrarHuella(int id)
{
  display_text("Coloque el dedo");
  while (finger.getImage() != FINGERPRINT_OK) ;
  // Imagen no creada
  if (finger.image2Tz(1) != FINGERPRINT_OK)   return false;

  display_text("Quite el dedo");
  delay(2000);
  while (finger.getImage() != FINGERPRINT_NOFINGER) ;

  display_text("Vuelva a colocar el dedo");
  while (finger.getImage() != FINGERPRINT_OK) ;
  // Copia de imagen no creada
  if (finger.image2Tz(2) != FINGERPRINT_OK)    return false;
  // Imagen no almacenada correctamente
  if (finger.storeModel(id) != FINGERPRINT_OK) return false;

  // Imagen creada y almacenada con exito
  return true;
}


// --- Busqueda de huella en memoria (sensor) ---
int buscarHuella()
{
  display_text("Coloque la huella");

  while (finger.getImage() != FINGERPRINT_OK)
    ;
  if (finger.image2Tz() != FINGERPRINT_OK)
  return -1;

  if (finger.fingerSearch() == FINGERPRINT_OK)
    return finger.fingerID;

  return -1;
=======
    Serial.print("Error al enviar registros. Código: ");
    Serial.println(httpResponseCode);
    // Si falla el envío, volvemos a guardar el registro actual en la pila
    stack_push(registro_actual);
  }
  
  http.end();
>>>>>>> probando_web
}

// ----------------------------------------------------
// FUNCIONES DE CONTROL WEB (NUEVAS)
// ----------------------------------------------------

void consultarEstado() {
  HTTPClient http;
  http.begin(statusUrl);
  
  int httpResponseCode = http.GET();
  
  if (httpResponseCode > 0) {
    String payload = http.getString();
    
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);
    
    if (!error) {
      String tipo = doc["tipo_lectura"].as<String>();
      
      // Si el servidor web pide registrar huella
      if (tipo == "nueva_huella" && modo_lectura != "nueva_huella") {
        modo_lectura = "nueva_huella";
        Serial.println("MODO REGISTRO ACTIVADO: Esperando nueva huella...");
        // Alerta de doble parpadeo para el coordinador
        activarAlarma(); 
        delay(200);
        activarAlarma();
      } 
      // Si el servidor web pide regresar a monitoreo de abordajes
      else if (tipo == "abordaje" && modo_lectura != "abordaje") {
        modo_lectura = "abordaje";
        Serial.println("Modo normal (Abordaje) restaurado.");
      }
    }
  }
  http.end();
}

void enviarNuevaHuella(String nueva_clave) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(enrollUrl);
    http.addHeader("Content-Type", "application/json");

    JsonDocument doc;
    doc["biometric_id"] = nueva_clave;

    String jsonPayload;
    serializeJson(doc, jsonPayload);

    int httpResponseCode = http.POST(jsonPayload);

    if (httpResponseCode == 201) {
      Serial.println("Nueva huella enviada exitosamente para vinculación.");
      activarAlarma(); 
    } else {
      Serial.print("Error al enviar nueva huella. Código: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  } else {
    Serial.println("Error: Sin conexión Wi-Fi para enrolar la huella.");
  }
}

// ----------------------------------------------------
// FUNCIONES AUXILIARES DE ALARMA Y PILA
// ----------------------------------------------------

void activarAlarma() {
  digitalWrite(RED_PIN, HIGH);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(1000); // Mantiene encendido por 1 segundo
  digitalWrite(RED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
}

void stack_push(Registro user) {
  if (STACK_POS < STACK_SIZE) {
    activarAlarma();
    USER_STACK[STACK_POS++] = user;
    Serial.println("Registro almacenado en la pila. Conexion a Internet no disponible");
<<<<<<< HEAD
  }
  else
    Serial.println("Registro no realizado. Pila de usuarios llena");
=======
  } else {
    Serial.println("Registro no realizado. Pila de usuarios llena");
    activarAlarma();
    activarAlarma(); // Doble pitido indicando memoria llena
  }
>>>>>>> probando_web
}

int stack_pop() {
  if (STACK_POS > 0) {
    return --STACK_POS;
  } else {
    return ST_ERROR;
<<<<<<< HEAD
}

// --- Acción sobre LED y Buzzer ---
void activarAlarma()
{
  digitalWrite(RED_PIN, HIGH);
  delay(500); // Mantiene encendido por 500 ms
  digitalWrite(RED_PIN, LOW);
}

// --- Obtencion de numeros mediante puerto serial ---
uint8_t readnumber(void)
{
  uint8_t num = 0;

  while (num == 0) {
    while (!Serial.available())
      ;
    num = Serial.parseInt();
  }
  return num;
}

// --- Reduce codigo repetitivo al usar display OLED ---
void display_text(char* text)
{
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println(F(text));
  display.display();
}
=======
  }
}
>>>>>>> probando_web
