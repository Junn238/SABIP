#include <SPI.h>
#include <WiFi.h>
#include <Wire.h>
#include <RTClib.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
 
// --- Componentes ---
RTC_DS1307 rtc;
#define SCREEN_WIDTH   128
#define SCREEN_HEIGHT  64
#define OLED_RESET     -1
#define SCREEN_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// --- Pines ---
#define RED_PIN 2
// #define BUZZER_PIN 4

// --- MACROS auxiliares para la pila ---
#define STACK_SIZE 32
#define ST_ERROR   -1

const uint8_t route = 32;

// --- Configuración WiFi / HTTP ---
// El SSID varia (obviamente)
const char* ssid = "INFINITUMB9B8";
// La contraseña tambien
const char* password = "g53kZGU5pS";
// Esta tambien
const char* serverUrl = "http://192.168.1.76:8080"; // Cambia por tu servidor/endpoint

// --- Estructura para almacenar registros de usuario  ---
struct Registro {
  String date;
  String biometric_id;
  String route;
};

Registro USER_STACK[STACK_SIZE] = {};
int STACK_POS = 0;

char bufferFecha[25];
uint8_t choice;

void setup() {
  Serial.begin(9600);

  pinMode(RED_PIN, OUTPUT);
  // pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(RED_PIN, LOW);
  // digitalWrite(BUZZER_PIN, LOW);

  // Inicializar pantalla OLED
  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println(F("SSD1306 allocation failed"));
    for (;;)
      ;
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(WHITE);

  // Inicializar RTC DS1307
  if (!rtc.begin()) {
    display.println(F("Error: DS3231 module not found"));
    display.display();
    for (;;)
      ;
  } else if (!rtc.isrunning()) {
    display.println(F("RTC sad, idk..."));
    display.display();
    delay(5000);
    // Ajusta el RTC a la fecha y hora de compilación
    // Actualizando 
  }

  // Descomentar si se desajusta el reloj 
  // rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  // DateTime now = rtc.now();
  // ajustar los segundos entre la compilacion y la escritura del codigo
  // uint8_t adjust_second = now.second() + 14;
  // uint8_t adjust_minute = now.minute();
  // if (adjust_second > 59) {
  //   adjust_second = adjust_second % 60;
  //   adjust_minute++;
  // }
  // rtc.adjust(DateTime(
  //   now.year(), now.month(), now.day(),
  //   now.hour(), adjust_minute, adjust_second
  // ));

  display.clearDisplay();
  // Intento opcional de conexión WiFi
  WiFi.begin(ssid, password);

  display.println(F("Ingrese tipo registro"));
  display.println(F("1. De usuario"));
  display.println(F("2. De asistencia"));
  display.display();
  choice = readnumber();
}

void loop() {

  switch(choice) {
    case 1: {
      newUser();
      break;
    }
    case 2: {
      leer_serial();
      break;
    }
    default: {
      display.clearDisplay();
      display.println(F("Opcion no valida :c"));
      display.display();
      delay(5000);
      break;
    }
  }
  
}

void newUser() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println(F("Ingrese ID en serial: "));
  display.display();

  while (!Serial.available())
    ;
  String bio_id = Serial.readStringUntil('\n');
  bio_id.trim();

  // No tocar
  if (bio_id.length() == 0)
    return; 

  display.clearDisplay();
  display.setCursor(0, 0);
  display.println(F("ID capturado"));
  display.println(F("Ingrese nombre de usuario:"));
  display.display();

  while (!Serial.available())
    ;
  String username = Serial.readStringUntil('\n');
  username.trim();

  if (username.length() == 0) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("Nombre invalido");
    display.display();
    delay(3000);
    return;
  }

  display.clearDisplay();
  display.setCursor(0, 0);
  display.println(F("Se inicio el proceso de registro"));
  display.display();

  crearUsuarioHTTP(bio_id, String(route), username);
}

void crearUsuarioHTTP(String bio_id, String route, String name) {
  if (WiFi.status() != WL_CONNECTED) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(F("Error: no WiFi"));
    display.display();
    delay(3000);
    return;
  }
  HTTPClient http;
  String url = String(serverUrl) + "/api/users";
  http.begin(url);
  http.addHeader("content-Type", "application/json");

  JsonDocument doc;
  doc["biometric_id"] = bio_id;
  doc["route"] = route;
  doc["name"] = name;

  String jsonPayload;
  serializeJson(doc, jsonPayload);
  int httpCode = http.POST(jsonPayload);

  display.clearDisplay();
  display.setCursor(0, 0);

  if (httpCode == 201) {
    display.println("Usuario registrado con exito");
  } else {
    Serial.printf("Error HTTP: %d", httpCode);
    display.println(F("Usuario NO registrado"));
  }
  display.display();
  delay(3000);
  http.end();
}

// Leer del puerto serial si hay datos disponibles
void leer_serial(void) {
  display.clearDisplay();
  display.setCursor(0,0);
  display.println(F("Ingrese id:"));
  display.display();
  
  while (!Serial.available())
    ;
  String entradaSerial = Serial.readStringUntil('\n');
  entradaSerial.trim();
  
  if (entradaSerial.length() > 0)
    process_log(entradaSerial); 
}

// --- Procesamiento de los datos ---
void process_log(String codigo) {

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
void enviarPeticionHTTP(Registro user) {
  HTTPClient http;
  String api_endpoint = String(serverUrl) + "/api/log";
  http.begin(api_endpoint);
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  String jsonPayload;
  bool isbatch = false;
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
    display.clearDisplay();
    Serial.printf("Error HTTP: %s:\n", http.errorToString(httpCode).c_str());
    display.println("Error con el servidor");
  }

  display.display();
  delay(3000);
  http.end();
}

String obtener_username(String biometric_id)
{
  if (WiFi.status() != WL_CONNECTED)
    return "No WiFi";

  HTTPClient http;
  String url = String(serverUrl) + "/api/users/id/" + biometric_id;
  http.begin(url);

  int httpCode =http.GET();
  String name = "NULL";

  if (httpCode == HTTP_CODE_OK || httpCode == 404)
    name = http.getString();
  else
    Serial.printf("Error en GET: %s\n", http.errorToString(httpCode).c_str());

  http.end();
  return name;
}

// --- Ingresa un registro de usuario a la pila ---
void stack_push(Registro user)
{
  if (STACK_POS < STACK_SIZE) {
    activarAlarma();
    USER_STACK[STACK_POS++] = user;
    Serial.println("Registro almacenado en la pila. Conexion a Internet no disponible");
    // Serial.printf("%2d %s %s\n", (STACK_POS-1), USER_STACK[STACK_POS-1].biometric, USER_STACK[STACK_POS-1].fecha
  }
  else {
    Serial.println("Registro no realizado. Pila de usuarios llena");
    activarAlarma();
    activarAlarma();
  }
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
void activarAlarma() {
  digitalWrite(RED_PIN, HIGH);
  // digitalWrite(BUZZER_PIN, HIGH);
  delay(500); // Mantiene encendido por 1 segundo
  digitalWrite(RED_PIN, LOW);
  // digitalWrite(BUZZER_PIN, LOW);
}

uint8_t readnumber(void) {
  uint8_t num = 0;

  while (num == 0) {
    while (!Serial.available())
      ;
    num = Serial.parseInt();
  }
  return num;
}
