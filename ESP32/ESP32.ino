#include <ArduinoJson.h>
#include <Wire.h>
#include <RTClib.h>
#include <WiFi.h>
#include <HTTPClient.h>

// --- CONFIGURACIÓN DE PINES Y RED ---
#define RED_PIN 2
#define BUZZER_PIN 4

// El SSID varia (obviamente)
const char* ssid = "INFINITUMB9B8";
// La contraseña tambien
const char* password = "g53kZGU5pS";

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


void setup() {
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

void enviarPeticionHTTP(Registro registro_actual) {
  int heap_index = 0;
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
  serializeJson(doc, jsonPayload);

  int httpResponseCode = http.POST(jsonPayload);

  if (httpResponseCode == 201) {
    Serial.println("Registros de abordaje enviados correctamente.");
    activarAlarma(); // Señal de éxito
  } else {
    Serial.print("Error al enviar registros. Código: ");
    Serial.println(httpResponseCode);
    // Si falla el envío, volvemos a guardar el registro actual en la pila
    stack_push(registro_actual);
  }
  
  http.end();
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
  } else {
    Serial.println("Registro no realizado. Pila de usuarios llena");
    activarAlarma();
    activarAlarma(); // Doble pitido indicando memoria llena
  }
}

int stack_pop() {
  if (STACK_POS > 0) {
    return --STACK_POS;
  } else {
    return ST_ERROR;
  }
}