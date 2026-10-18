#include <SPI.h>
#include <WiFi.h>
#include <Wire.h>
#include <RTClib.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <HardwareSerial.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_Fingerprint.h>

// --- Componentes ---
RTC_DS1307 rtc;

#define SCREEN_WIDTH   128
#define SCREEN_HEIGHT  64
#define OLED_RESET     -1
#define SCREEN_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

// --- Pines ---
#define RED_PIN 2

// --- MACROS auxiliares para la pila ---
#define STACK_SIZE 48
#define ST_ERROR   -1

// --- Configuración WiFi / HTTP ---
const char* ssid = "INFINITUMB9B8";
const char* password = "g53kZGU5pS";
// Para el servidor puede variar la ip, pero el puerto siempre es el mismo
// El puerto para escuchar peticiones esta definido como 8080
// serverUrl = http://X.X.X.X:8080
const char* serverUrl = "http://192.168.1.76:8080";

// --- Estructura para almacenar registros de usuario  ---
struct Registro {
  String date;
  String biometric_id;
  String route;
};

Registro USER_STACK[STACK_SIZE] = {};
int STACK_POS = 0;

// --- variables globales y definiciones auxiliares ---
const String route = "ruta 32";
char bufferFecha[25];
#define REGISTER 0
#define NEW_USER 1
uint8_t choice;


void setup() {
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
  String user_id = codigo;

  DateTime ahora = rtc.now();
  snprintf(bufferFecha, sizeof(bufferFecha), "%04d-%02d-%02d %02d:%02d:%02d",
    ahora.year(), ahora.month(), ahora.day(),
    ahora.hour(), ahora.minute(), ahora.second()
  );

  Registro registro_auxiliar = {
    String(bufferFecha), user_id, String(route)
  };

  if (WiFi.status() == WL_CONNECTED)
    // Intentar enviar petición HTTP POST
    enviarPeticionHTTP(registro_auxiliar);
  else
    // Envia el registro formateado a la pila
    stack_push(registro_auxiliar);
}

// --- Envío de Datos por HTTP POST ---
void enviarPeticionHTTP(Registro user)
{
  HTTPClient http;
  String api_endpoint = String(serverUrl) + "/api/log";
  http.begin(api_endpoint);
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  String jsonPayload;
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

  serializeJson(doc, jsonPayload);
  Serial.println("HTTP generado: "+jsonPayload);

  int httpCode = http.POST(jsonPayload);

  display.clearDisplay();
  display.setCursor(0, 0);

  if (httpCode == 201) {
    activarAlarma();
    if (isbatch) {
      display.println(F("Sincronizacion realizada"));
      display.printf("%d registros subidos\n", load);
    } else {
      String user_name = obtener_username(user.biometric_id);
      display.println(F("Acceso registrado"));
      display.println(user.date);
      display.println(user_name);
    }
  } else {
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
}

// --- Ingresa un registro de usuario a la pila ---
void stack_push(Registro user)
{
  if (STACK_POS < STACK_SIZE) {
    activarAlarma();
    USER_STACK[STACK_POS++] = user;
    Serial.println("Registro almacenado en la pila. Conexion a Internet no disponible");
  }
  else
    Serial.println("Registro no realizado. Pila de usuarios llena");
}

//  --- Elimina un registro de usuario de la pila ---
uint8_t stack_pop()
{
  if (STACK_POS > 0)
    return STACK_POS--;
  else
    return ST_ERROR;
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
