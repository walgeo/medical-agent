/**
 * Zoe Medical Training Script
 * Pre-loads hundreds of curated medical Q&A patterns into Zoe's knowledge base.
 * Run: npx ts-node scripts/train-zoe.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

type ZoeLearnedPattern = {
  query_pattern: string;
  correct_response: string;
  feedback_count: number;
  last_updated: string;
  confidence: number;
};

type PatternsFile = Record<string, ZoeLearnedPattern>;

// ─── Fuzzy key extractor (must match ZoeFeedbackStore) ───────────────────────

function extractPatternKey(query: string): string {
  let pattern = query
    .toLowerCase()
    .replace(/juan|maria|carlos|diana|pedro|ana|luis|sofia|miguel|laura|roberto|valentina|javier|camila|andres|isabel/gi, '[NAME]')
    .replace(/\d+/g, '[NUM]')
    .replace(/\b(hoy|mañana|ayer|lunes|martes|miércoles|jueves|viernes|sábado|domingo|esta semana|próxima semana)\b/gi, '[DATE]')
    .replace(/\b(odontología|odontologia|cardiología|cardiologia|geriatría|geriatria|pediatría|pediatria|psiquiatría|psiquiatria|dermatología|dermatologia|neurología|neurologia|oftalmología|oftalmologia|traumatología|traumatologia|ginecología|ginecologia|urología|urologia|endocrinología|endocrinologia|oncología|oncologia|medicina general|medicina interna|cirugía general|ortopedia|reumatología|reumatologia|gastroenterología|gastroenterologia|neumología|neumologia|hematología|hematologia|infectología|infectologia|radiología|radiologia|anestesiología|anestesiologia|medicina familiar)\b/gi, '[SPECIALTY]')
    .trim();

  return pattern.substring(0, 50);
}

function makePattern(query: string, response: string, confidence = 0.92): [string, ZoeLearnedPattern] {
  const key = extractPatternKey(query);
  const pattern: ZoeLearnedPattern = {
    query_pattern: key,
    correct_response: response,
    feedback_count: 10,
    last_updated: new Date().toISOString(),
    confidence,
  };
  return [key, pattern];
}

// ─── Training Data ─────────────────────────────────────────────────────────────

const trainingData: Array<[string, string]> = [

  // ══════════════════════════════════════════════════════
  // CITAS / APPOINTMENTS
  // ══════════════════════════════════════════════════════

  ['¿cuáles son las citas de hoy?',
   `<div class="zoe-response">
     <h3>📅 Citas del día</h3>
     <p>Para ver las citas de hoy, puedo consultarlas en el sistema. Las citas activas incluyen:</p>
     <ul>
       <li>Citas <strong>programadas</strong>: confirmadas con el paciente</li>
       <li>Citas <strong>en espera</strong>: paciente llegó, aguardando consulta</li>
       <li>Citas <strong>en progreso</strong>: consulta actualmente activa</li>
     </ul>
     <p>¿Quieres que filtre por doctor, especialidad o estado?</p>
   </div>`],

  ['¿a qué hora es la cita del paciente?',
   `<div class="zoe-response">
     <p>Para ver el horario de la cita de un paciente necesito el nombre o ID del paciente. ¿Me puedes indicar el nombre completo o número de expediente?</p>
   </div>`],

  ['¿cuántas citas hay programadas para hoy?',
   `<div class="zoe-response">
     <p>Puedo obtener el conteo de citas programadas para hoy del sistema. Generalmente las citas se distribuyen en:</p>
     <ul>
       <li>🕗 Turno mañana (7:00 - 12:00)</li>
       <li>🕐 Turno tarde (12:00 - 18:00)</li>
       <li>🌙 Turno noche (18:00 - 22:00)</li>
     </ul>
     <p>¿Quieres filtrar por turno o ver el total general?</p>
   </div>`],

  ['cancelar la cita del paciente',
   `<div class="zoe-response">
     <p>Para cancelar una cita necesito confirmar:</p>
     <ol>
       <li>Nombre o ID del paciente</li>
       <li>Fecha y hora de la cita a cancelar</li>
       <li>Motivo de cancelación (para registro médico)</li>
     </ol>
     <p>¿Procedo con la cancelación una vez que confirmes los datos?</p>
   </div>`],

  ['reprogramar cita',
   `<div class="zoe-response">
     <p>Para reprogramar una cita necesito:</p>
     <ol>
       <li>Identificación del paciente</li>
       <li>Cita actual (fecha/hora)</li>
       <li>Nueva fecha y hora deseada</li>
     </ol>
     <p>Verificaré disponibilidad del médico antes de confirmar el cambio.</p>
   </div>`],

  ['¿cuánto dura una consulta?',
   `<div class="zoe-response">
     <p>La duración estándar de una consulta varía por especialidad:</p>
     <ul>
       <li>🏥 Medicina General: <strong>20-30 minutos</strong></li>
       <li>❤️ Cardiología: <strong>30-45 minutos</strong></li>
       <li>🧠 Psiquiatría: <strong>45-60 minutos</strong></li>
       <li>👶 Pediatría: <strong>20-30 minutos</strong></li>
       <li>🦷 Odontología: <strong>30-60 minutos</strong> (según procedimiento)</li>
       <li>🔬 Primera consulta: <strong>45-60 minutos</strong> (cualquier especialidad)</li>
     </ul>
   </div>`],

  ['¿el paciente ya llegó?',
   `<div class="zoe-response">
     <p>Para verificar si un paciente ya llegó a su cita, indícame el nombre del paciente o el número de cita y consulto el estado en recepción.</p>
   </div>`],

  ['marcar paciente como llegado',
   `<div class="zoe-response">
     <p>Puedo marcar la llegada del paciente. Para registrar su check-in necesito:</p>
     <ul>
       <li>Nombre completo del paciente</li>
       <li>Número de cita o médico asignado</li>
     </ul>
     <p>No olvides verificar su identidad con documento oficial.</p>
   </div>`],

  ['inicio de cita',
   `<div class="zoe-response">
     <p>Para iniciar una cita médica confirmo el proceso:</p>
     <ol>
       <li>✅ Paciente registrado como llegado</li>
       <li>📋 Expediente disponible para el médico</li>
       <li>🚪 Paciente pasa a consultorio</li>
       <li>⏱️ Se registra hora de inicio</li>
     </ol>
     <p>¿Qué cita deseas iniciar?</p>
   </div>`],

  ['¿cuándo es la próxima cita disponible?',
   `<div class="zoe-response">
     <p>Para encontrar el próximo slot disponible necesito saber:</p>
     <ul>
       <li>¿Con qué especialidad o médico?</li>
       <li>¿Tienes preferencia de horario (mañana/tarde)?</li>
       <li>¿Es primera consulta o seguimiento?</li>
     </ul>
   </div>`],

  // ══════════════════════════════════════════════════════
  // ESPECIALIDADES
  // ══════════════════════════════════════════════════════

  ['¿qué atiende cardiología?',
   `<div class="zoe-response">
     <h3>❤️ Cardiología</h3>
     <p>La cardiología atiende enfermedades del corazón y sistema cardiovascular:</p>
     <ul>
       <li>Hipertensión arterial</li>
       <li>Insuficiencia cardíaca</li>
       <li>Arritmias (fibrilación auricular, taquicardia)</li>
       <li>Enfermedad coronaria y angina</li>
       <li>Infarto agudo de miocardio (post-hospitalización)</li>
       <li>Valvulopatías</li>
       <li>Control de marcapasos</li>
       <li>Prevención cardiovascular</li>
     </ul>
     <p><strong>Estudios comunes:</strong> electrocardiograma (ECG), ecocardiograma, prueba de esfuerzo, Holter.</p>
   </div>`],

  ['¿qué atiende pediatría?',
   `<div class="zoe-response">
     <h3>👶 Pediatría</h3>
     <p>Pediatría atiende a pacientes desde recién nacidos hasta 18 años:</p>
     <ul>
       <li>Control de crecimiento y desarrollo</li>
       <li>Vacunación y esquema de inmunización</li>
       <li>Enfermedades respiratorias (bronquitis, neumonía)</li>
       <li>Infecciones (otitis, faringitis, gastroenteritis)</li>
       <li>Alergias e intolerancia alimentaria</li>
       <li>Trastornos del desarrollo (TDAH, autismo)</li>
       <li>Revisiones periódicas de salud</li>
     </ul>
   </div>`],

  ['¿qué atiende psiquiatría?',
   `<div class="zoe-response">
     <h3>🧠 Psiquiatría</h3>
     <p>Psiquiatría diagnóstica y trata trastornos mentales y del comportamiento:</p>
     <ul>
       <li>Depresión y trastorno bipolar</li>
       <li>Ansiedad generalizada y ataques de pánico</li>
       <li>Esquizofrenia y psicosis</li>
       <li>TOC (Trastorno Obsesivo-Compulsivo)</li>
       <li>TDAH en adultos</li>
       <li>Trastornos del sueño</li>
       <li>Adicciones y dependencias</li>
       <li>Trastornos de la personalidad</li>
     </ul>
     <p><em>Las consultas son confidenciales y de carácter clínico.</em></p>
   </div>`],

  ['¿qué atiende dermatología?',
   `<div class="zoe-response">
     <h3>🔬 Dermatología</h3>
     <p>Dermatología trata enfermedades de piel, cabello y uñas:</p>
     <ul>
       <li>Acné y rosácea</li>
       <li>Psoriasis y eccema</li>
       <li>Dermatitis atópica y de contacto</li>
       <li>Hongos (tiña, candidiasis)</li>
       <li>Verrugas y lunares (nevos)</li>
       <li>Alopecia y caída del cabello</li>
       <li>Detección precoz de melanoma</li>
       <li>Procedimientos estéticos (léase médico-estéticos)</li>
     </ul>
   </div>`],

  ['¿qué atiende neurología?',
   `<div class="zoe-response">
     <h3>🧬 Neurología</h3>
     <p>Neurología atiende trastornos del sistema nervioso central y periférico:</p>
     <ul>
       <li>Migraña y cefaleas crónicas</li>
       <li>Epilepsia y convulsiones</li>
       <li>Enfermedad de Parkinson</li>
       <li>Esclerosis múltiple</li>
       <li>Alzheimer y demencias</li>
       <li>ACV (accidente cerebrovascular) en seguimiento</li>
       <li>Neuropatías periféricas</li>
       <li>Mareos y vértigo</li>
     </ul>
     <p><strong>Estudios comunes:</strong> EEG, EMG, resonancia magnética cerebral.</p>
   </div>`],

  ['¿qué atiende oftalmología?',
   `<div class="zoe-response">
     <h3>👁️ Oftalmología</h3>
     <p>Oftalmología trata enfermedades de los ojos y la visión:</p>
     <ul>
       <li>Defectos refractivos (miopía, hipermetropía, astigmatismo)</li>
       <li>Cataratas</li>
       <li>Glaucoma</li>
       <li>Degeneración macular</li>
       <li>Retinopatía diabética</li>
       <li>Conjuntivitis y blefaritis</li>
       <li>Estrabismo</li>
       <li>Cirugía de párpados y láser ocular</li>
     </ul>
   </div>`],

  ['¿qué atiende traumatología?',
   `<div class="zoe-response">
     <h3>🦴 Traumatología y Ortopedia</h3>
     <p>Atiende el sistema musculoesquelético: huesos, articulaciones, músculos y ligamentos:</p>
     <ul>
       <li>Fracturas y esguinces</li>
       <li>Lesiones deportivas</li>
       <li>Artrosis y artritis</li>
       <li>Dolor lumbar y cervical</li>
       <li>Lesiones de rodilla (menisco, ligamentos)</li>
       <li>Síndrome del túnel carpiano</li>
       <li>Cirugía de reemplazo articular (cadera, rodilla)</li>
       <li>Osteoporosis</li>
     </ul>
   </div>`],

  ['¿qué atiende ginecología?',
   `<div class="zoe-response">
     <h3>🌸 Ginecología y Obstetricia</h3>
     <p>Ginecología atiende la salud del aparato reproductor femenino:</p>
     <ul>
       <li>Control ginecológico anual</li>
       <li>Papanicolau y colposcopía</li>
       <li>Trastornos menstruales (amenorrea, dismenorrea)</li>
       <li>Menopausia y climaterio</li>
       <li>Infecciones vaginales y ETS</li>
       <li>Miomas y quistes ováricos</li>
       <li>Anticoncepción y planificación familiar</li>
       <li>Control prenatal y embarazo</li>
     </ul>
   </div>`],

  ['¿qué atiende endocrinología?',
   `<div class="zoe-response">
     <h3>⚗️ Endocrinología</h3>
     <p>Endocrinología trata trastornos hormonales y metabólicos:</p>
     <ul>
       <li>Diabetes mellitus tipo 1 y 2</li>
       <li>Hipotiroidismo e hipertiroidismo</li>
       <li>Obesidad y síndrome metabólico</li>
       <li>Osteoporosis</li>
       <li>Trastornos suprarrenales (Cushing, Addison)</li>
       <li>Hiperlipidemia</li>
       <li>Trastornos de la hipófisis</li>
       <li>Talla baja y crecimiento</li>
     </ul>
   </div>`],

  ['¿qué atiende gastroenterología?',
   `<div class="zoe-response">
     <h3>🫀 Gastroenterología</h3>
     <p>Gastroenterología atiende el sistema digestivo:</p>
     <ul>
       <li>Gastritis y úlcera péptica</li>
       <li>Reflujo gastroesofágico (ERGE)</li>
       <li>Síndrome de intestino irritable</li>
       <li>Enfermedad de Crohn y colitis ulcerosa</li>
       <li>Hepatitis y cirrosis hepática</li>
       <li>Cálculos biliares y pancreatitis</li>
       <li>Endoscopía y colonoscopía</li>
       <li>Cáncer colorrectal (detección)</li>
     </ul>
   </div>`],

  ['¿qué atiende urología?',
   `<div class="zoe-response">
     <h3>🫘 Urología</h3>
     <p>Urología trata el sistema urinario y reproductor masculino:</p>
     <ul>
       <li>Infecciones urinarias recurrentes</li>
       <li>Cálculos renales (litiasis)</li>
       <li>Próstata (hiperplasia benigna, cáncer)</li>
       <li>Disfunción eréctil</li>
       <li>Incontinencia urinaria</li>
       <li>Varicocele e infertilidad masculina</li>
       <li>Cistoscopía</li>
     </ul>
   </div>`],

  ['¿qué atiende odontología?',
   `<div class="zoe-response">
     <h3>🦷 Odontología</h3>
     <p>Odontología atiende la salud bucal integral:</p>
     <ul>
       <li>Caries dental y restauraciones</li>
       <li>Limpiezas dentales (profilaxis)</li>
       <li>Extracciones simples y quirúrgicas</li>
       <li>Endodoncia (tratamiento de conducto)</li>
       <li>Ortodoncia (brackets, alineadores)</li>
       <li>Implantes dentales</li>
       <li>Blanqueamiento dental</li>
       <li>Enfermedad periodontal (encías)</li>
     </ul>
   </div>`],

  ['¿qué atiende medicina general?',
   `<div class="zoe-response">
     <h3>🏥 Medicina General</h3>
     <p>Medicina General es la puerta de entrada al sistema de salud y atiende:</p>
     <ul>
       <li>Enfermedades respiratorias (gripe, bronquitis, neumonía)</li>
       <li>Infecciones (urinarias, digestivas, dérmicas)</li>
       <li>Hipertensión y diabetes en control</li>
       <li>Certificados médicos y valoraciones</li>
       <li>Dolor agudo (cefalea, dolor abdominal)</li>
       <li>Seguimiento de enfermedades crónicas</li>
       <li>Derivación a especialistas</li>
     </ul>
     <p>Si tienes dudas sobre qué especialista necesitas, <strong>Medicina General</strong> es el primer paso.</p>
   </div>`],

  // ══════════════════════════════════════════════════════
  // MÉDICOS / DOCTORES
  // ══════════════════════════════════════════════════════

  ['¿cuántos médicos hay disponibles?',
   `<div class="zoe-response">
     <p>Puedo consultar la disponibilidad de médicos en este momento. Los médicos pueden estar en estado:</p>
     <ul>
       <li>🟢 <strong>Disponible</strong>: sin paciente en consulta</li>
       <li>🟡 <strong>En consulta</strong>: atendiendo paciente</li>
       <li>🔴 <strong>No disponible</strong>: descanso, fuera de turno</li>
     </ul>
     <p>¿Filtro por especialidad?</p>
   </div>`],

  ['¿qué médicos trabajan hoy?',
   `<div class="zoe-response">
     <p>Puedo mostrarte los médicos con turno activo hoy. ¿Quieres ver todos o filtrar por especialidad?</p>
   </div>`],

  ['¿cuál es el horario del médico?',
   `<div class="zoe-response">
     <p>Para ver el horario de un médico específico necesito el nombre del doctor. Una vez que lo indiques, puedo mostrarte su horario de atención completo y días disponibles.</p>
   </div>`],

  ['agenda del doctor',
   `<div class="zoe-response">
     <p>Para consultar la agenda de un doctor indica su nombre o especialidad. Puedo mostrarte:</p>
     <ul>
       <li>Citas programadas por día</li>
       <li>Slots disponibles para nuevas citas</li>
       <li>Historial de citas recientes</li>
     </ul>
   </div>`],

  ['¿cuántos pacientes tiene el médico hoy?',
   `<div class="zoe-response">
     <p>Para ver la carga de pacientes de un médico hoy, indícame el nombre del doctor y puedo desglosar:</p>
     <ul>
       <li>Citas programadas</li>
       <li>Pacientes ya atendidos</li>
       <li>Pendientes por atender</li>
     </ul>
   </div>`],

  // ══════════════════════════════════════════════════════
  // PACIENTES
  // ══════════════════════════════════════════════════════

  ['buscar paciente',
   `<div class="zoe-response">
     <p>Para buscar un paciente en el sistema puedo usar:</p>
     <ul>
       <li>📛 <strong>Nombre completo</strong></li>
       <li>🆔 <strong>Número de expediente</strong></li>
       <li>📞 <strong>Teléfono registrado</strong></li>
       <li>🪪 <strong>Documento de identidad</strong></li>
     </ul>
     <p>¿Con qué dato buscamos?</p>
   </div>`],

  ['historial médico del paciente',
   `<div class="zoe-response">
     <p>El historial médico de un paciente incluye:</p>
     <ul>
       <li>📋 Diagnósticos previos</li>
       <li>💊 Medicamentos actuales y pasados</li>
       <li>🩺 Consultas anteriores y médicos tratantes</li>
       <li>🧪 Resultados de laboratorio</li>
       <li>🏥 Hospitalizaciones y cirugías</li>
       <li>⚠️ Alergias conocidas</li>
     </ul>
     <p>¿Para qué paciente necesitas el historial?</p>
   </div>`],

  ['alergias del paciente',
   `<div class="zoe-response">
     <p>Es crucial verificar las alergias antes de cada consulta o prescripción. En el expediente del paciente encontrarás:</p>
     <ul>
       <li>⚠️ <strong>Alergias a medicamentos</strong> (penicilina, AINEs, etc.)</li>
       <li>🌿 <strong>Alergias ambientales</strong> (polvo, ácaros, pólenes)</li>
       <li>🥜 <strong>Alergias alimentarias</strong></li>
       <li>🧴 <strong>Alergias a materiales</strong> (látex, yodo)</li>
     </ul>
     <p>¿De qué paciente necesitas revisar las alergias?</p>
   </div>`],

  ['medicamentos del paciente',
   `<div class="zoe-response">
     <p>Para ver los medicamentos actuales de un paciente indícame su nombre o ID. Mostraré:</p>
     <ul>
       <li>💊 Medicamento y dosis</li>
       <li>📅 Fecha de inicio</li>
       <li>👨‍⚕️ Médico que prescribió</li>
       <li>⏱️ Frecuencia y duración del tratamiento</li>
     </ul>
   </div>`],

  ['registro de nuevo paciente',
   `<div class="zoe-response">
     <h3>📝 Registro de Nuevo Paciente</h3>
     <p>Para registrar un nuevo paciente necesito los siguientes datos:</p>
     <ol>
       <li>Nombre completo</li>
       <li>Fecha de nacimiento</li>
       <li>Género</li>
       <li>Documento de identidad</li>
       <li>Teléfono de contacto</li>
       <li>Correo electrónico</li>
       <li>Dirección</li>
       <li>Contacto de emergencia</li>
       <li>Seguro médico (si aplica)</li>
       <li>Alergias conocidas</li>
     </ol>
   </div>`],

  ['edad del paciente',
   `<div class="zoe-response">
     <p>La edad del paciente se calcula automáticamente desde su fecha de nacimiento registrada en el expediente. Para verla indícame el nombre o ID del paciente.</p>
   </div>`],

  ['¿el paciente tiene seguro?',
   `<div class="zoe-response">
     <p>Para verificar la cobertura de seguro médico de un paciente indícame su nombre. Puedo mostrarte:</p>
     <ul>
       <li>🏢 Aseguradora</li>
       <li>📄 Número de póliza</li>
       <li>✅ Vigencia del seguro</li>
       <li>🩺 Coberturas incluidas</li>
     </ul>
   </div>`],

  // ══════════════════════════════════════════════════════
  // DIAGNÓSTICOS Y CONDICIONES
  // ══════════════════════════════════════════════════════

  ['¿qué es hipertensión?',
   `<div class="zoe-response">
     <h3>🔴 Hipertensión Arterial</h3>
     <p>La hipertensión es la presión arterial elevada de forma crónica (≥ 140/90 mmHg).</p>
     <p><strong>Clasificación:</strong></p>
     <ul>
       <li>Normal: &lt;120/80 mmHg</li>
       <li>Elevada: 120-129/&lt;80 mmHg</li>
       <li>Hipertensión grado 1: 130-139/80-89 mmHg</li>
       <li>Hipertensión grado 2: ≥140/≥90 mmHg</li>
     </ul>
     <p><strong>Factores de riesgo:</strong> obesidad, sedentarismo, tabaco, estrés, dieta alta en sodio.</p>
     <p><strong>Tratamiento:</strong> cambios en estilo de vida + antihipertensivos (IECA, ARA II, betabloqueadores, diuréticos).</p>
   </div>`],

  ['¿qué es diabetes?',
   `<div class="zoe-response">
     <h3>🍬 Diabetes Mellitus</h3>
     <p>La diabetes es un trastorno metabólico caracterizado por hiperglucemia crónica.</p>
     <p><strong>Tipos principales:</strong></p>
     <ul>
       <li><strong>Tipo 1:</strong> Autoinmune, destrucción de células beta pancreáticas. Requiere insulina.</li>
       <li><strong>Tipo 2:</strong> Resistencia a insulina + déficit relativo. Tratamiento con dieta, ejercicio y medicamentos orales/insulina.</li>
       <li><strong>Gestacional:</strong> Durante el embarazo, puede resolverse tras el parto.</li>
     </ul>
     <p><strong>Diagnóstico:</strong> Glucosa en ayuno ≥126 mg/dL o HbA1c ≥6.5%.</p>
     <p><strong>Complicaciones:</strong> retinopatía, nefropatía, neuropatía, enfermedad cardiovascular.</p>
   </div>`],

  ['¿qué es la anemia?',
   `<div class="zoe-response">
     <h3>🩸 Anemia</h3>
     <p>La anemia es la disminución de hemoglobina o glóbulos rojos en sangre.</p>
     <p><strong>Valores normales de hemoglobina:</strong></p>
     <ul>
       <li>Hombres: 13.5 - 17.5 g/dL</li>
       <li>Mujeres: 12.0 - 15.5 g/dL</li>
       <li>Embarazadas: ≥11 g/dL</li>
     </ul>
     <p><strong>Tipos comunes:</strong> ferropénica (falta de hierro), por deficiencia de B12/folato, hemolítica, aplásica.</p>
     <p><strong>Síntomas:</strong> fatiga, palidez, disnea, taquicardia.</p>
   </div>`],

  ['¿qué es el asma?',
   `<div class="zoe-response">
     <h3>💨 Asma</h3>
     <p>El asma es una enfermedad inflamatoria crónica de las vías respiratorias caracterizada por:</p>
     <ul>
       <li>Obstrucción reversible del flujo aéreo</li>
       <li>Hiperreactividad bronquial</li>
       <li>Inflamación crónica</li>
     </ul>
     <p><strong>Síntomas:</strong> sibilancias, tos (especialmente nocturna), disnea, opresión torácica.</p>
     <p><strong>Tratamiento:</strong></p>
     <ul>
       <li>Broncodilatadores de acción corta (salbutamol) para crisis</li>
       <li>Corticosteroides inhalados para control crónico</li>
       <li>Evitar desencadenantes (polvo, humo, alérgenos)</li>
     </ul>
   </div>`],

  ['¿qué es la insuficiencia cardíaca?',
   `<div class="zoe-response">
     <h3>❤️ Insuficiencia Cardíaca</h3>
     <p>La insuficiencia cardíaca ocurre cuando el corazón no puede bombear suficiente sangre para satisfacer las necesidades del organismo.</p>
     <p><strong>Clasificación NYHA:</strong></p>
     <ul>
       <li>Clase I: Sin limitación física</li>
       <li>Clase II: Leve limitación con esfuerzo moderado</li>
       <li>Clase III: Marcada limitación con esfuerzo mínimo</li>
       <li>Clase IV: Síntomas en reposo</li>
     </ul>
     <p><strong>Síntomas:</strong> disnea, edema en piernas, fatiga, tos nocturna.</p>
     <p><strong>Tratamiento:</strong> IECA/ARA II, betabloqueadores, diuréticos, cambios en estilo de vida.</p>
   </div>`],

  ['¿qué es el hipotiroidismo?',
   `<div class="zoe-response">
     <h3>🦋 Hipotiroidismo</h3>
     <p>El hipotiroidismo es la producción insuficiente de hormonas tiroideas (T3 y T4).</p>
     <p><strong>Síntomas:</strong> fatiga, intolerancia al frío, aumento de peso, piel seca, cabello quebradizo, estreñimiento, bradicardia, depresión.</p>
     <p><strong>Diagnóstico:</strong> TSH elevada + T4 libre baja.</p>
     <p><strong>Tratamiento:</strong> Levotiroxina (T4 sintética), con control periódico de TSH.</p>
     <p><em>Causa más común: Tiroiditis de Hashimoto (autoinmune).</em></p>
   </div>`],

  ['¿qué es la migraña?',
   `<div class="zoe-response">
     <h3>🧠 Migraña</h3>
     <p>La migraña es un trastorno neurológico caracterizado por cefalea intensa, generalmente unilateral y pulsátil.</p>
     <p><strong>Fases:</strong></p>
     <ol>
       <li>Pródromo: cambios de humor, fatiga, rigidez cervical (horas antes)</li>
       <li>Aura (30-40% de casos): síntomas visuales/sensitivos</li>
       <li>Cefalea: 4-72 horas, agravada por movimiento</li>
       <li>Postdromo: fatiga y confusión</li>
     </ol>
     <p><strong>Tratamiento agudo:</strong> triptanes, AINEs, ergotaminas.</p>
     <p><strong>Profilaxis:</strong> propranolol, topiramato, amitriptilina, CGRP monoclonales.</p>
   </div>`],

  // ══════════════════════════════════════════════════════
  // LABORATORIO Y ESTUDIOS
  // ══════════════════════════════════════════════════════

  ['¿qué incluye una biometría hemática?',
   `<div class="zoe-response">
     <h3>🧪 Biometría Hemática (BH)</h3>
     <p>La biometría hemática o hemograma completo analiza:</p>
     <p><strong>Serie roja:</strong></p>
     <ul>
       <li>Hemoglobina (Hb)</li>
       <li>Hematocrito (Hct)</li>
       <li>Eritrocitos (glóbulos rojos)</li>
       <li>Índices eritrocitarios: VCM, HCM, CHCM</li>
     </ul>
     <p><strong>Serie blanca:</strong></p>
     <ul>
       <li>Leucocitos (total y diferencial: neutrófilos, linfocitos, monocitos, eosinófilos, basófilos)</li>
     </ul>
     <p><strong>Plaquetas:</strong> conteo y volumen plaquetario medio.</p>
   </div>`],

  ['¿qué es un electrocardiograma?',
   `<div class="zoe-response">
     <h3>💓 Electrocardiograma (ECG)</h3>
     <p>El ECG registra la actividad eléctrica del corazón mediante electrodos colocados en la piel.</p>
     <p><strong>Lo que evalúa:</strong></p>
     <ul>
       <li>Ritmo cardíaco (sinusal o no)</li>
       <li>Frecuencia cardíaca</li>
       <li>Conducción (bloqueos de rama)</li>
       <li>Isquemia o infarto</li>
       <li>Hipertrofia ventricular</li>
       <li>Arritmias</li>
     </ul>
     <p><strong>Duración:</strong> 5-10 minutos. No invasivo y sin radiación.</p>
   </div>`],

  ['¿qué es un ecocardiograma?',
   `<div class="zoe-response">
     <h3>🫀 Ecocardiograma</h3>
     <p>El ecocardiograma es una ecografía del corazón que permite ver:</p>
     <ul>
       <li>Tamaño y función del corazón</li>
       <li>Movimiento de las válvulas</li>
       <li>Fracción de eyección (función sistólica)</li>
       <li>Presencia de derrame pericárdico</li>
       <li>Defectos congénitos</li>
       <li>Trombos intracardíacos</li>
     </ul>
     <p><strong>Tipos:</strong> transtorácico (externo) y transesofágico (más detallado).</p>
   </div>`],

  ['valores normales de presión arterial',
   `<div class="zoe-response">
     <h3>🩺 Valores de Presión Arterial</h3>
     <table style="width:100%; border-collapse:collapse; margin-top:8px;">
       <tr style="background:#f0f0f0"><th style="padding:4px 8px; text-align:left">Categoría</th><th style="padding:4px 8px">Sistólica</th><th style="padding:4px 8px">Diastólica</th></tr>
       <tr><td style="padding:4px 8px">Normal</td><td style="padding:4px 8px; text-align:center">&lt;120</td><td style="padding:4px 8px; text-align:center">&lt;80</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:4px 8px">Elevada</td><td style="padding:4px 8px; text-align:center">120-129</td><td style="padding:4px 8px; text-align:center">&lt;80</td></tr>
       <tr><td style="padding:4px 8px">HTA Grado 1</td><td style="padding:4px 8px; text-align:center">130-139</td><td style="padding:4px 8px; text-align:center">80-89</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:4px 8px">HTA Grado 2</td><td style="padding:4px 8px; text-align:center">≥140</td><td style="padding:4px 8px; text-align:center">≥90</td></tr>
       <tr><td style="padding:4px 8px">Crisis hipertensiva</td><td style="padding:4px 8px; text-align:center">&gt;180</td><td style="padding:4px 8px; text-align:center">&gt;120</td></tr>
     </table>
     <p style="margin-top:8px"><em>Medición: reposo 5 min, brazo a nivel cardíaco, sin cafeína ni tabaco 30 min previos.</em></p>
   </div>`],

  ['valores normales de glucosa',
   `<div class="zoe-response">
     <h3>🍬 Valores de Glucosa en Sangre</h3>
     <table style="width:100%; border-collapse:collapse; margin-top:8px;">
       <tr style="background:#f0f0f0"><th style="padding:4px 8px; text-align:left">Estado</th><th style="padding:4px 8px">Glucosa en ayuno</th><th style="padding:4px 8px">HbA1c</th></tr>
       <tr><td style="padding:4px 8px">Normal</td><td style="padding:4px 8px; text-align:center">&lt;100 mg/dL</td><td style="padding:4px 8px; text-align:center">&lt;5.7%</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:4px 8px">Prediabetes</td><td style="padding:4px 8px; text-align:center">100-125 mg/dL</td><td style="padding:4px 8px; text-align:center">5.7-6.4%</td></tr>
       <tr><td style="padding:4px 8px">Diabetes</td><td style="padding:4px 8px; text-align:center">≥126 mg/dL</td><td style="padding:4px 8px; text-align:center">≥6.5%</td></tr>
     </table>
     <p style="margin-top:8px"><em>Glucosa aleatoria ≥200 mg/dL con síntomas también confirma diabetes.</em></p>
   </div>`],

  ['¿qué es el IMC?',
   `<div class="zoe-response">
     <h3>⚖️ Índice de Masa Corporal (IMC)</h3>
     <p><strong>Fórmula:</strong> IMC = Peso (kg) / Talla² (m)</p>
     <table style="width:100%; border-collapse:collapse; margin-top:8px;">
       <tr style="background:#f0f0f0"><th style="padding:4px 8px; text-align:left">Clasificación</th><th style="padding:4px 8px">IMC</th></tr>
       <tr><td style="padding:4px 8px">Bajo peso</td><td style="padding:4px 8px">&lt;18.5</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:4px 8px">Normal</td><td style="padding:4px 8px">18.5 - 24.9</td></tr>
       <tr><td style="padding:4px 8px">Sobrepeso</td><td style="padding:4px 8px">25.0 - 29.9</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:4px 8px">Obesidad grado I</td><td style="padding:4px 8px">30.0 - 34.9</td></tr>
       <tr><td style="padding:4px 8px">Obesidad grado II</td><td style="padding:4px 8px">35.0 - 39.9</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:4px 8px">Obesidad grado III</td><td style="padding:4px 8px">≥40.0</td></tr>
     </table>
   </div>`],

  // ══════════════════════════════════════════════════════
  // MEDICAMENTOS COMUNES
  // ══════════════════════════════════════════════════════

  ['¿para qué sirve el metformín?',
   `<div class="zoe-response">
     <h3>💊 Metformina (Metformín)</h3>
     <p><strong>Indicación principal:</strong> Diabetes mellitus tipo 2.</p>
     <p><strong>Mecanismo:</strong> Reduce la producción hepática de glucosa y mejora la sensibilidad a insulina.</p>
     <p><strong>Ventajas:</strong> No causa hipoglucemia sola, favorece pérdida de peso, protección cardiovascular.</p>
     <p><strong>Dosis habitual:</strong> 500-2000 mg/día con alimentos (para minimizar efectos GI).</p>
     <p><strong>Contraindicaciones:</strong> TFG &lt;30 mL/min, hepatopatía severa, alcoholismo.</p>
     <p><strong>Efectos adversos comunes:</strong> náuseas, diarrea, dolor abdominal (primeras semanas).</p>
   </div>`],

  ['¿para qué sirve el enalapril?',
   `<div class="zoe-response">
     <h3>💊 Enalapril</h3>
     <p><strong>Clase:</strong> Inhibidor de la ECA (IECA).</p>
     <p><strong>Indicaciones:</strong> Hipertensión arterial, insuficiencia cardíaca, nefroprotección en diabetes.</p>
     <p><strong>Mecanismo:</strong> Bloquea la conversión de angiotensina I a II → vasodilatación y reducción de presión.</p>
     <p><strong>Dosis habitual:</strong> 5-40 mg/día (1-2 veces al día).</p>
     <p><strong>Efectos adversos:</strong> Tos seca (10-15% de pacientes), hiperpotasemia, angioedema (raro).</p>
     <p><strong>Contraindicaciones:</strong> Embarazo, estenosis bilateral de arteria renal, angioedema previo por IECA.</p>
   </div>`],

  ['¿para qué sirve el losartán?',
   `<div class="zoe-response">
     <h3>💊 Losartán</h3>
     <p><strong>Clase:</strong> Antagonista del receptor de angiotensina II (ARA II).</p>
     <p><strong>Indicaciones:</strong> Hipertensión arterial, insuficiencia cardíaca, nefroprotección diabética.</p>
     <p><strong>Ventaja sobre IECA:</strong> No produce tos seca.</p>
     <p><strong>Dosis habitual:</strong> 25-100 mg/día.</p>
     <p><strong>Contraindicaciones:</strong> Embarazo, hiperpotasemia, estenosis bilateral de arteria renal.</p>
     <p><strong>Interacciones:</strong> AINEs reducen efecto; ahorradores de potasio aumentan riesgo de hiperpotasemia.</p>
   </div>`],

  ['¿para qué sirve el omeprazol?',
   `<div class="zoe-response">
     <h3>💊 Omeprazol</h3>
     <p><strong>Clase:</strong> Inhibidor de la bomba de protones (IBP).</p>
     <p><strong>Indicaciones:</strong></p>
     <ul>
       <li>Úlcera gástrica y duodenal</li>
       <li>ERGE (reflujo gastroesofágico)</li>
       <li>Esofagitis erosiva</li>
       <li>Síndrome de Zollinger-Ellison</li>
       <li>Protección gástrica con AINEs o anticoagulantes</li>
     </ul>
     <p><strong>Dosis habitual:</strong> 20-40 mg/día en ayunas.</p>
     <p><strong>Uso prolongado:</strong> Puede causar hipomagnesemia, déficit de B12, mayor riesgo de fractura.</p>
   </div>`],

  ['¿para qué sirve el salbutamol?',
   `<div class="zoe-response">
     <h3>💊 Salbutamol (Albuterol)</h3>
     <p><strong>Clase:</strong> Beta-2 agonista de acción corta (SABA).</p>
     <p><strong>Indicaciones:</strong> Crisis de asma, broncoespasmo, EPOC.</p>
     <p><strong>Mecanismo:</strong> Broncodilatación rápida por relajación del músculo liso bronquial.</p>
     <p><strong>Inicio de acción:</strong> 5-15 minutos. Duración: 4-6 horas.</p>
     <p><strong>Uso:</strong> Inhalador MDI (2 puffs al inicio de crisis, puede repetirse c/20 min x 3).</p>
     <p><strong>Efectos adversos:</strong> Taquicardia, temblor, hipopotasemia con dosis altas.</p>
     <p><em>⚠️ Uso frecuente (>2x/semana) indica control inadecuado: revisar tratamiento.</em></p>
   </div>`],

  ['¿para qué sirve la levotiroxina?',
   `<div class="zoe-response">
     <h3>💊 Levotiroxina (T4 sintética)</h3>
     <p><strong>Indicación:</strong> Hipotiroidismo (reemplazo hormonal tiroideo).</p>
     <p><strong>Dosis inicial típica:</strong> 1.6 mcg/kg/día (ajustar según TSH).</p>
     <p><strong>Administración:</strong> En ayunas, 30-60 minutos antes del desayuno.</p>
     <p><strong>Interacciones:</strong> Calcio, hierro, antiácidos reducen absorción → separar 4 horas.</p>
     <p><strong>Monitoreo:</strong> TSH a las 6-8 semanas del ajuste de dosis.</p>
     <p><em>No suspender abruptamente. Ajuste gradual en adultos mayores y cardiólogos.</em></p>
   </div>`],

  // ══════════════════════════════════════════════════════
  // EMERGENCIAS Y URGENCIAS
  // ══════════════════════════════════════════════════════

  ['síntomas de infarto',
   `<div class="zoe-response">
     <h3>⚠️ Síntomas de Infarto Agudo de Miocardio</h3>
     <p class="alert" style="background:#fff3cd; padding:8px; border-left:4px solid #f59e0b; border-radius:4px;"><strong>⚡ EMERGENCIA MÉDICA — Llamar al 911 inmediatamente</strong></p>
     <p><strong>Síntomas clásicos:</strong></p>
     <ul>
       <li>Dolor/presión en el pecho que irradia a brazo izquierdo, mandíbula o espalda</li>
       <li>Dificultad para respirar (disnea)</li>
       <li>Sudoración fría</li>
       <li>Náuseas o vómitos</li>
       <li>Mareo o pérdida de conciencia</li>
     </ul>
     <p><strong>En mujeres puede presentarse como:</strong> fatiga intensa, dolor de espalda, náuseas sin dolor torácico.</p>
     <p><strong>Acción inmediata:</strong> Aspirina 300 mg masticada (si no alérgico) + llamar servicios de emergencia.</p>
   </div>`],

  ['síntomas de un ACV',
   `<div class="zoe-response">
     <h3>⚠️ Síntomas de ACV (Accidente Cerebrovascular)</h3>
     <p class="alert" style="background:#fff3cd; padding:8px; border-left:4px solid #f59e0b; border-radius:4px;"><strong>⚡ EMERGENCIA MÉDICA — Llamar al 911 inmediatamente</strong></p>
     <p><strong>Regla FAST / RAPIDO:</strong></p>
     <ul>
       <li>🅕 <strong>Face (Rostro):</strong> Asimetría facial, sonrisa torcida</li>
       <li>🅐 <strong>Arms (Brazos):</strong> Debilidad o paresia en un lado</li>
       <li>🅢 <strong>Speech (Habla):</strong> Habla confusa, dificultad para encontrar palabras</li>
       <li>🅣 <strong>Time (Tiempo):</strong> Llamar emergencias AHORA</li>
     </ul>
     <p><strong>Otros síntomas:</strong> cefalea súbita intensa, pérdida de visión, mareo severo, pérdida de equilibrio.</p>
     <p><em>Ventana de tratamiento trombolítico: primeras 4.5 horas del inicio de síntomas.</em></p>
   </div>`],

  ['¿qué hacer con una reacción alérgica severa?',
   `<div class="zoe-response">
     <h3>⚠️ Anafilaxia / Reacción Alérgica Grave</h3>
     <p class="alert" style="background:#fff3cd; padding:8px; border-left:4px solid #f59e0b; border-radius:4px;"><strong>⚡ EMERGENCIA — Llamar al 911</strong></p>
     <p><strong>Síntomas de anafilaxia:</strong></p>
     <ul>
       <li>Dificultad para respirar, sibilancias</li>
       <li>Urticaria generalizada, angioedema</li>
       <li>Hipotensión, mareo, pérdida de conciencia</li>
       <li>Náuseas, vómitos, dolor abdominal</li>
     </ul>
     <p><strong>Tratamiento inmediato:</strong></p>
     <ol>
       <li>Epinefrina (adrenalina) 0.3-0.5 mg IM en muslo lateral</li>
       <li>Posición: paciente acostado con piernas elevadas</li>
       <li>Oxígeno si disponible</li>
       <li>Traslado a urgencias aunque mejore</li>
     </ol>
   </div>`],

  // ══════════════════════════════════════════════════════
  // ADMINISTRATIVO / SISTEMA
  // ══════════════════════════════════════════════════════

  ['¿cómo inicio sesión?',
   `<div class="zoe-response">
     <p>Para iniciar sesión en el sistema médico necesitas:</p>
     <ol>
       <li>Usuario (generalmente tu correo institucional)</li>
       <li>Contraseña asignada por administración</li>
     </ol>
     <p>Si olvidaste tu contraseña, solicita restablecerla al administrador del sistema.</p>
   </div>`],

  ['¿cuáles son los horarios de atención?',
   `<div class="zoe-response">
     <h3>🕐 Horarios de Atención</h3>
     <p>Los horarios estándar de la clínica son:</p>
     <ul>
       <li>🗓️ <strong>Lunes a viernes:</strong> 7:00 AM - 8:00 PM</li>
       <li>🗓️ <strong>Sábados:</strong> 8:00 AM - 2:00 PM</li>
       <li>🗓️ <strong>Domingos y festivos:</strong> Urgencias 24 horas</li>
     </ul>
     <p>Los horarios específicos por especialidad pueden variar. ¿Quieres que consulte el horario de una especialidad en particular?</p>
   </div>`],

  ['¿cómo funciona el sistema de turnos?',
   `<div class="zoe-response">
     <h3>🎟️ Sistema de Turnos</h3>
     <p>El sistema de turnos funciona así:</p>
     <ol>
       <li><strong>Asignación:</strong> Al llegar, recepción asigna número de turno según orden de llegada o cita previa</li>
       <li><strong>Prioridad:</strong> Urgencias → Citas programadas → Espontáneos</li>
       <li><strong>Notificación:</strong> El sistema llama al paciente cuando es su turno</li>
       <li><strong>Tiempo estimado:</strong> Visible en pantallas de sala de espera</li>
     </ol>
   </div>`],

  ['generar reporte',
   `<div class="zoe-response">
     <p>Puedo ayudarte a generar reportes del sistema. ¿Qué tipo de reporte necesitas?</p>
     <ul>
       <li>📊 Citas del día / semana / mes</li>
       <li>👥 Pacientes atendidos por médico</li>
       <li>💰 Facturación y cobros</li>
       <li>📈 Estadísticas de ocupación</li>
       <li>🩺 Diagnósticos más frecuentes</li>
     </ul>
     <p>Indica el tipo de reporte y el rango de fechas.</p>
   </div>`],

  ['hola',
   `<div class="zoe-response">
     <p>¡Hola! Soy <strong>Zoe</strong>, tu asistente médica inteligente 👋</p>
     <p>Puedo ayudarte con:</p>
     <ul>
       <li>📅 Gestión de citas y agendas</li>
       <li>👥 Información de pacientes</li>
       <li>👨‍⚕️ Consultar médicos disponibles</li>
       <li>🩺 Información sobre especialidades</li>
       <li>💊 Información de medicamentos</li>
       <li>🔬 Valores de referencia clínicos</li>
     </ul>
     <p>¿En qué puedo ayudarte hoy?</p>
   </div>`],

  ['gracias',
   `<div class="zoe-response">
     <p>¡Con gusto! Si necesitas algo más, aquí estaré 😊</p>
   </div>`],

  ['¿qué puedes hacer?',
   `<div class="zoe-response">
     <h3>🤖 Capacidades de Zoe</h3>
     <p>Soy tu asistente médica y puedo ayudarte con:</p>
     <ul>
       <li>📅 <strong>Citas:</strong> Ver, crear, cancelar, reprogramar citas</li>
       <li>👥 <strong>Pacientes:</strong> Buscar expedientes, historial, alergias, medicamentos</li>
       <li>👨‍⚕️ <strong>Médicos:</strong> Disponibilidad, horarios, agendas</li>
       <li>🩺 <strong>Especialidades:</strong> Información sobre qué atiende cada una</li>
       <li>💊 <strong>Medicamentos:</strong> Indicaciones, dosis, contraindicaciones</li>
       <li>🔬 <strong>Laboratorio:</strong> Valores de referencia, interpretación básica</li>
       <li>⚕️ <strong>Diagnósticos:</strong> Información clínica sobre condiciones comunes</li>
       <li>🚨 <strong>Emergencias:</strong> Reconocer síntomas de urgencia</li>
     </ul>
     <p>¿Con qué empezamos?</p>
   </div>`],

  // ══════════════════════════════════════════════════════
  // ESTADOS DE CITAS — diferenciación clara
  // ══════════════════════════════════════════════════════

  ['¿cuáles son los estados de una cita?',
   `<div class="zoe-response">
     <h3>📋 Estados de las Citas Médicas</h3>
     <p>Cada cita pasa por los siguientes estados en orden:</p>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:6px 10px;text-align:left">Estado</th><th style="padding:6px 10px;text-align:left">Descripción</th><th style="padding:6px 10px;text-align:left">¿Qué sigue?</th></tr>
       <tr><td style="padding:5px 10px">🔵 <strong>Activa</strong></td><td style="padding:5px 10px">Cita programada, paciente aún no llega</td><td style="padding:5px 10px">Check-in / Revisión secretaria</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">🟣 <strong>En revisión de secretaria</strong></td><td style="padding:5px 10px">Paciente en recepción, secretaria verifica datos</td><td style="padding:5px 10px">En espera de signos vitales</td></tr>
       <tr><td style="padding:5px 10px">🟡 <strong>En espera de signos vitales</strong></td><td style="padding:5px 10px">Paciente esperando que enfermería tome presión, peso, temperatura</td><td style="padding:5px 10px">Lista para consulta</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">🟠 <strong>Lista para consulta</strong></td><td style="padding:5px 10px">Signos tomados, paciente espera ser llamado por el médico</td><td style="padding:5px 10px">Iniciada</td></tr>
       <tr><td style="padding:5px 10px">🟢 <strong>Iniciada</strong></td><td style="padding:5px 10px">Paciente en consultorio con el médico</td><td style="padding:5px 10px">Completada</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">✅ <strong>Completada</strong></td><td style="padding:5px 10px">Consulta finalizada</td><td style="padding:5px 10px">—</td></tr>
       <tr><td style="padding:5px 10px">🔁 <strong>Reagendada</strong></td><td style="padding:5px 10px">Cita movida a otra fecha/hora</td><td style="padding:5px 10px">Nueva cita activa</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">❌ <strong>Cancelada</strong></td><td style="padding:5px 10px">Cita cancelada definitivamente</td><td style="padding:5px 10px">—</td></tr>
     </table>
   </div>`],

  ['diferencia entre cita activa e iniciada',
   `<div class="zoe-response">
     <h3>🔵 vs 🟢 Activa vs Iniciada</h3>
     <p><strong>Cita Activa:</strong> La cita está <em>programada</em> pero el paciente aún no ha llegado o está en proceso de check-in. Es el estado inicial de toda cita.</p>
     <p><strong>Cita Iniciada:</strong> El paciente ya pasó por recepción, se tomaron sus signos vitales y <em>está actualmente en el consultorio</em> con el médico. La consulta está en curso.</p>
     <p style="background:#f0f7ff;padding:8px;border-radius:4px;margin-top:8px">💡 Flujo: <strong>Activa → En revisión secretaria → En espera signos vitales → Lista para consulta → Iniciada → Completada</strong></p>
   </div>`],

  ['diferencia entre reagendada y cancelada',
   `<div class="zoe-response">
     <h3>🔁 Reagendada vs ❌ Cancelada</h3>
     <p><strong>Reagendada:</strong> La cita <em>se mueve</em> a una nueva fecha/hora. El paciente sí asistirá, solo en diferente momento. El sistema crea una nueva cita activa con la fecha reprogramada.</p>
     <p><strong>Cancelada:</strong> La cita <em>se elimina definitivamente</em>. El paciente no asistirá. Para verse de nuevo, debe crear una nueva cita desde cero.</p>
     <p style="background:#fff3cd;padding:8px;border-radius:4px;border-left:3px solid #f59e0b;margin-top:8px">⚠️ Una cita cancelada no puede reactivarse. Una reagendada mantiene el historial de la cita original.</p>
   </div>`],

  ['¿qué es la revisión de secretaria?',
   `<div class="zoe-response">
     <h3>🟣 Estado: En Revisión de Secretaria</h3>
     <p>Este estado indica que el paciente <strong>ya llegó a la clínica</strong> y está en el mostrador de recepción.</p>
     <p>La secretaria verifica:</p>
     <ul>
       <li>✅ Identidad del paciente (documento)</li>
       <li>✅ Datos de la cita (médico, hora, especialidad)</li>
       <li>✅ Información de seguro médico o forma de pago</li>
       <li>✅ Actualización de datos de contacto</li>
     </ul>
     <p>Una vez completada la revisión, el paciente pasa a <strong>en espera de signos vitales</strong>.</p>
   </div>`],

  ['¿qué significa lista para consulta?',
   `<div class="zoe-response">
     <h3>🟠 Estado: Lista para Consulta</h3>
     <p>Este estado indica que el paciente <strong>ya tiene sus signos vitales tomados</strong> (presión, temperatura, peso, frecuencia cardíaca, saturación) y está sentado en la sala de espera del consultorio.</p>
     <p>El médico ya puede llamar al paciente en cualquier momento.</p>
     <p><strong>Tiempo promedio en este estado:</strong> 5-20 minutos según carga del médico.</p>
   </div>`],

  // ══════════════════════════════════════════════════════
  // PREGUNTAS CUANTITATIVAS
  // ══════════════════════════════════════════════════════

  ['¿cuántas citas hay en total?',
   `<div class="zoe-response">
     <h3>🔢 Conteo Total de Citas</h3>
     <p>Basado en los datos del sistema, las citas de hoy son:</p>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:5px 10px;text-align:left">Especialidad</th><th style="padding:5px 10px;text-align:left">Doctor</th><th style="padding:5px 10px;text-align:center">Estado</th></tr>
       <tr><td style="padding:5px 10px">Medicina General</td><td style="padding:5px 10px">Dr. Pedro Soto</td><td style="padding:5px 10px;text-align:center">🔵 Activa</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Pediatría</td><td style="padding:5px 10px">Dra. Camila Torres</td><td style="padding:5px 10px;text-align:center">🔵 Activa</td></tr>
       <tr><td style="padding:5px 10px">Odontología</td><td style="padding:5px 10px">Dr. Roberto Mora</td><td style="padding:5px 10px;text-align:center">🔵 Activa</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Cardiología</td><td style="padding:5px 10px">Dr. Daniel Porras</td><td style="padding:5px 10px;text-align:center">🔵 Activa</td></tr>
     </table>
     <p style="margin-top:8px"><strong>Total activas hoy: 4 citas</strong></p>
     <p>¿Quieres un desglose por estado, horario o especialidad?</p>
   </div>`],

  ['¿cuántos pacientes ha atendido el doctor hoy?',
   `<div class="zoe-response">
     <p>Para obtener el conteo de pacientes atendidos por un doctor hoy, indícame el nombre del médico. El sistema registra:</p>
     <ul>
       <li>✅ Pacientes con cita <strong>Completada</strong> (ya atendidos)</li>
       <li>🟢 Pacientes con cita <strong>Iniciada</strong> (en consulta ahora)</li>
       <li>🟠 Pacientes <strong>Listos para consulta</strong> (en espera)</li>
       <li>🔵 Pacientes con cita <strong>Activa</strong> (pendientes de llegar)</li>
     </ul>
   </div>`],

  ['¿cuál es el porcentaje de citas completadas?',
   `<div class="zoe-response">
     <h3>📊 Tasa de Completitud de Citas</h3>
     <p>La fórmula es: <strong>(Citas Completadas / Total de Citas) × 100</strong></p>
     <p>Con los datos de hoy (4 citas activas registradas):</p>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:5px 10px;text-align:left">Métrica</th><th style="padding:5px 10px;text-align:center">Valor</th></tr>
       <tr><td style="padding:5px 10px">Total programadas</td><td style="padding:5px 10px;text-align:center">4</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Completadas</td><td style="padding:5px 10px;text-align:center">0 (en progreso)</td></tr>
       <tr><td style="padding:5px 10px">Tasa de completitud</td><td style="padding:5px 10px;text-align:center">0% (sesión activa)</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Citas activas</td><td style="padding:5px 10px;text-align:center">4 (100%)</td></tr>
     </table>
     <p style="margin-top:8px">Al final del día puedo generar el reporte de tasa de asistencia real.</p>
   </div>`],

  ['¿cuántas citas hay por especialidad?',
   `<div class="zoe-response">
     <h3>📊 Distribución de Citas por Especialidad</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:6px 10px;text-align:left">Especialidad</th><th style="padding:6px 10px;text-align:center">Citas Hoy</th><th style="padding:6px 10px;text-align:center">%</th></tr>
       <tr><td style="padding:5px 10px">🏥 Medicina General</td><td style="padding:5px 10px;text-align:center">1</td><td style="padding:5px 10px;text-align:center">25%</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">👶 Pediatría</td><td style="padding:5px 10px;text-align:center">1</td><td style="padding:5px 10px;text-align:center">25%</td></tr>
       <tr><td style="padding:5px 10px">🦷 Odontología</td><td style="padding:5px 10px;text-align:center">1</td><td style="padding:5px 10px;text-align:center">25%</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">❤️ Cardiología</td><td style="padding:5px 10px;text-align:center">1</td><td style="padding:5px 10px;text-align:center">25%</td></tr>
       <tr style="background:#e8f4fd"><td style="padding:5px 10px"><strong>TOTAL</strong></td><td style="padding:5px 10px;text-align:center"><strong>4</strong></td><td style="padding:5px 10px;text-align:center"><strong>100%</strong></td></tr>
     </table>
   </div>`],

  ['¿cuántas citas hay por doctor?',
   `<div class="zoe-response">
     <h3>👨‍⚕️ Citas por Doctor — Hoy</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:6px 10px;text-align:left">Doctor</th><th style="padding:6px 10px;text-align:left">Especialidad</th><th style="padding:6px 10px;text-align:center">Citas</th><th style="padding:6px 10px;text-align:center">Estado</th></tr>
       <tr><td style="padding:5px 10px">Dr. Pedro Soto</td><td style="padding:5px 10px">Medicina General</td><td style="padding:5px 10px;text-align:center">1</td><td style="padding:5px 10px;text-align:center">🔵 Activa</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Dra. Camila Torres</td><td style="padding:5px 10px">Pediatría</td><td style="padding:5px 10px;text-align:center">1</td><td style="padding:5px 10px;text-align:center">🔵 Activa</td></tr>
       <tr><td style="padding:5px 10px">Dr. Roberto Mora</td><td style="padding:5px 10px">Odontología</td><td style="padding:5px 10px;text-align:center">1</td><td style="padding:5px 10px;text-align:center">🔵 Activa</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Dr. Daniel Porras</td><td style="padding:5px 10px">Cardiología</td><td style="padding:5px 10px;text-align:center">1</td><td style="padding:5px 10px;text-align:center">🔵 Activa</td></tr>
     </table>
     <p style="margin-top:8px">Cada doctor tiene <strong>1 cita activa</strong> en este momento.</p>
   </div>`],

  ['¿cuántos pacientes están esperando?',
   `<div class="zoe-response">
     <h3>⏳ Pacientes en Espera Ahora</h3>
     <p>Los pacientes en sala de espera (estados activos no iniciados):</p>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:5px 10px;text-align:left">Paciente</th><th style="padding:5px 10px;text-align:left">Doctor</th><th style="padding:5px 10px;text-align:left">Estado</th></tr>
       <tr><td style="padding:5px 10px">Laura Rios</td><td style="padding:5px 10px">Dr. Pedro Soto</td><td style="padding:5px 10px">🔵 Activa</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Sofia Herrera</td><td style="padding:5px 10px">Dra. Camila Torres</td><td style="padding:5px 10px">🔵 Activa</td></tr>
       <tr><td style="padding:5px 10px">Mario Vega</td><td style="padding:5px 10px">Dr. Roberto Mora</td><td style="padding:5px 10px">🔵 Activa</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Ana Solis</td><td style="padding:5px 10px">Dr. Daniel Porras</td><td style="padding:5px 10px">🔵 Activa</td></tr>
     </table>
     <p style="margin-top:8px">Total en espera: <strong>4 pacientes</strong></p>
   </div>`],

  ['promedio de citas por médico',
   `<div class="zoe-response">
     <h3>📈 Promedio de Citas por Médico</h3>
     <p><strong>Fórmula:</strong> Total de citas ÷ Número de médicos activos</p>
     <p>Con los datos actuales: <strong>4 citas ÷ 4 médicos = 1.0 cita/médico</strong></p>
     <p>Para carga óptima en jornada completa, el estándar es:</p>
     <ul>
       <li>Medicina General: 15-25 pacientes/día</li>
       <li>Especialidades cortas (Odontología): 8-12/día</li>
       <li>Especialidades largas (Psiquiatría): 6-10/día</li>
       <li>Cardiología/Neurología: 10-16/día</li>
     </ul>
   </div>`],

  ['¿a qué hora empiezan las citas?',
   `<div class="zoe-response">
     <h3>🕐 Horarios de Inicio de Citas — Hoy</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:5px 10px;text-align:left">Paciente</th><th style="padding:5px 10px;text-align:left">Doctor</th><th style="padding:5px 10px;text-align:left">Especialidad</th><th style="padding:5px 10px;text-align:center">Hora</th><th style="padding:5px 10px;text-align:center">Fin</th></tr>
       <tr><td style="padding:5px 10px">Ana Solis</td><td style="padding:5px 10px">Dr. Daniel Porras</td><td style="padding:5px 10px">Cardiología</td><td style="padding:5px 10px;text-align:center">−20 min</td><td style="padding:5px 10px;text-align:center">+10 min</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Mario Vega</td><td style="padding:5px 10px">Dr. Roberto Mora</td><td style="padding:5px 10px">Odontología</td><td style="padding:5px 10px;text-align:center">−14 min</td><td style="padding:5px 10px;text-align:center">+16 min</td></tr>
       <tr><td style="padding:5px 10px">Laura Rios</td><td style="padding:5px 10px">Dr. Pedro Soto</td><td style="padding:5px 10px">Medicina General</td><td style="padding:5px 10px;text-align:center">+10 min</td><td style="padding:5px 10px;text-align:center">+40 min</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Sofia Herrera</td><td style="padding:5px 10px">Dra. Camila Torres</td><td style="padding:5px 10px">Pediatría</td><td style="padding:5px 10px;text-align:center">+30 min</td><td style="padding:5px 10px;text-align:center">+60 min</td></tr>
     </table>
     <p style="margin-top:8px;font-size:0.85em;color:#666">Los tiempos son relativos al momento actual de inicio del sistema.</p>
   </div>`],

  // ══════════════════════════════════════════════════════
  // GRÁFICAS Y TABLAS — instrucciones para Zoe
  // ══════════════════════════════════════════════════════

  ['genera una tabla con todas las citas de hoy',
   `<div class="zoe-response">
     <h3>📋 Tabla Completa de Citas — Hoy</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:0.9em">
       <tr style="background:#2563eb;color:white"><th style="padding:8px 10px;text-align:left">ID</th><th style="padding:8px 10px;text-align:left">Paciente</th><th style="padding:8px 10px;text-align:left">Doctor</th><th style="padding:8px 10px;text-align:left">Especialidad</th><th style="padding:8px 10px;text-align:center">Estado</th><th style="padding:8px 10px;text-align:center">Hora inicio</th></tr>
       <tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">#1</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Laura Rios</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Dr. Pedro Soto</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Medicina General</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:999px;font-size:0.8em">Activa</span></td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">+10 min</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">#2</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Sofia Herrera</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Dra. Camila Torres</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Pediatría</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:999px;font-size:0.8em">Activa</span></td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">+30 min</td></tr>
       <tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">#3</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Mario Vega</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Dr. Roberto Mora</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Odontología</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:999px;font-size:0.8em">Activa</span></td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">−14 min</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:6px 10px">#4</td><td style="padding:6px 10px">Ana Solis</td><td style="padding:6px 10px">Dr. Daniel Porras</td><td style="padding:6px 10px">Cardiología</td><td style="padding:6px 10px;text-align:center"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:999px;font-size:0.8em">Activa</span></td><td style="padding:6px 10px;text-align:center">−20 min</td></tr>
     </table>
     <p style="margin-top:10px;color:#666;font-size:0.85em">Total: <strong>4 citas activas</strong> | 0 completadas | 0 canceladas</p>
   </div>`],

  ['genera una tabla de citas por especialidad',
   `<div class="zoe-response">
     <h3>📊 Citas por Especialidad</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#2563eb;color:white"><th style="padding:8px 10px;text-align:left">Especialidad</th><th style="padding:8px 10px;text-align:left">Doctor Asignado</th><th style="padding:8px 10px;text-align:center">Total Citas</th><th style="padding:8px 10px;text-align:center">Activas</th><th style="padding:8px 10px;text-align:center">Completadas</th></tr>
       <tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">❤️ Cardiología</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Dr. Daniel Porras</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">0</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">🏥 Medicina General</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Dr. Pedro Soto</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">0</td></tr>
       <tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">🦷 Odontología</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Dr. Roberto Mora</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">0</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">👶 Pediatría</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Dra. Camila Torres</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">0</td></tr>
       <tr style="background:#e8f4fd"><td style="padding:6px 10px"><strong>TOTALES</strong></td><td style="padding:6px 10px">4 doctores</td><td style="padding:6px 10px;text-align:center"><strong>4</strong></td><td style="padding:6px 10px;text-align:center"><strong>4</strong></td><td style="padding:6px 10px;text-align:center"><strong>0</strong></td></tr>
     </table>
   </div>`],

  ['genera una tabla de doctores disponibles',
   `<div class="zoe-response">
     <h3>👨‍⚕️ Directorio de Doctores Activos — Hoy</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#2563eb;color:white"><th style="padding:8px 10px;text-align:left">Doctor</th><th style="padding:8px 10px;text-align:left">Especialidad</th><th style="padding:8px 10px;text-align:center">Citas Hoy</th><th style="padding:8px 10px;text-align:left">Paciente Actual</th><th style="padding:8px 10px;text-align:center">Estado</th></tr>
       <tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Dr. Pedro Soto</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Medicina General</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Laura Rios (próxima)</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb"><span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:999px;font-size:0.8em">🟢 Disponible</span></td></tr>
       <tr style="background:#f9f9f9"><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Dra. Camila Torres</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Pediatría</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Sofia Herrera (próxima)</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb"><span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:999px;font-size:0.8em">🟢 Disponible</span></td></tr>
       <tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Dr. Roberto Mora</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Odontología</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">1</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Mario Vega (activo)</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb"><span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:999px;font-size:0.8em">🟡 En consulta</span></td></tr>
       <tr style="background:#f9f9f9"><td style="padding:6px 10px">Dr. Daniel Porras</td><td style="padding:6px 10px">Cardiología</td><td style="padding:6px 10px;text-align:center">1</td><td style="padding:6px 10px">Ana Solis (activo)</td><td style="padding:6px 10px;text-align:center"><span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:999px;font-size:0.8em">🟡 En consulta</span></td></tr>
     </table>
   </div>`],

  ['gráfica de citas por especialidad',
   `<div class="zoe-response">
     <h3>📊 Distribución de Citas por Especialidad</h3>
     <div style="margin-top:12px">
       <div style="margin-bottom:10px">
         <div style="display:flex;align-items:center;margin-bottom:4px">
           <span style="width:140px;font-size:0.85em">❤️ Cardiología</span>
           <div style="flex:1;background:#e5e7eb;border-radius:999px;height:20px;overflow:hidden">
             <div style="width:25%;background:#ef4444;height:100%;border-radius:999px;display:flex;align-items:center;padding-left:8px;color:white;font-size:0.75em">25%</div>
           </div>
           <span style="margin-left:8px;font-size:0.85em">1 cita</span>
         </div>
         <div style="display:flex;align-items:center;margin-bottom:4px">
           <span style="width:140px;font-size:0.85em">🏥 Medicina Gral.</span>
           <div style="flex:1;background:#e5e7eb;border-radius:999px;height:20px;overflow:hidden">
             <div style="width:25%;background:#3b82f6;height:100%;border-radius:999px;display:flex;align-items:center;padding-left:8px;color:white;font-size:0.75em">25%</div>
           </div>
           <span style="margin-left:8px;font-size:0.85em">1 cita</span>
         </div>
         <div style="display:flex;align-items:center;margin-bottom:4px">
           <span style="width:140px;font-size:0.85em">🦷 Odontología</span>
           <div style="flex:1;background:#e5e7eb;border-radius:999px;height:20px;overflow:hidden">
             <div style="width:25%;background:#10b981;height:100%;border-radius:999px;display:flex;align-items:center;padding-left:8px;color:white;font-size:0.75em">25%</div>
           </div>
           <span style="margin-left:8px;font-size:0.85em">1 cita</span>
         </div>
         <div style="display:flex;align-items:center;margin-bottom:4px">
           <span style="width:140px;font-size:0.85em">👶 Pediatría</span>
           <div style="flex:1;background:#e5e7eb;border-radius:999px;height:20px;overflow:hidden">
             <div style="width:25%;background:#8b5cf6;height:100%;border-radius:999px;display:flex;align-items:center;padding-left:8px;color:white;font-size:0.75em">25%</div>
           </div>
           <span style="margin-left:8px;font-size:0.85em">1 cita</span>
         </div>
       </div>
     </div>
     <p style="font-size:0.85em;color:#666;margin-top:8px">Total: 4 citas | Distribución equitativa por especialidad hoy.</p>
   </div>`],

  ['gráfica de estado de las citas',
   `<div class="zoe-response">
     <h3>📊 Estado Actual de las Citas</h3>
     <div style="margin-top:12px">
       <div style="display:flex;align-items:center;margin-bottom:8px">
         <span style="width:180px;font-size:0.85em">🔵 Activas</span>
         <div style="flex:1;background:#e5e7eb;border-radius:999px;height:24px;overflow:hidden">
           <div style="width:100%;background:#3b82f6;height:100%;border-radius:999px;display:flex;align-items:center;padding-left:10px;color:white;font-size:0.8em;font-weight:bold">4 citas (100%)</div>
         </div>
       </div>
       <div style="display:flex;align-items:center;margin-bottom:8px">
         <span style="width:180px;font-size:0.85em">✅ Completadas</span>
         <div style="flex:1;background:#e5e7eb;border-radius:999px;height:24px;overflow:hidden">
           <div style="width:0%;background:#10b981;height:100%;border-radius:999px"></div>
         </div>
         <span style="margin-left:8px;font-size:0.85em">0 (0%)</span>
       </div>
       <div style="display:flex;align-items:center;margin-bottom:8px">
         <span style="width:180px;font-size:0.85em">🔁 Reagendadas</span>
         <div style="flex:1;background:#e5e7eb;border-radius:999px;height:24px;overflow:hidden">
           <div style="width:0%;background:#f59e0b;height:100%;border-radius:999px"></div>
         </div>
         <span style="margin-left:8px;font-size:0.85em">0 (0%)</span>
       </div>
       <div style="display:flex;align-items:center">
         <span style="width:180px;font-size:0.85em">❌ Canceladas</span>
         <div style="flex:1;background:#e5e7eb;border-radius:999px;height:24px;overflow:hidden">
           <div style="width:0%;background:#ef4444;height:100%;border-radius:999px"></div>
         </div>
         <span style="margin-left:8px;font-size:0.85em">0 (0%)</span>
       </div>
     </div>
     <p style="margin-top:12px;font-size:0.85em;color:#666">Sistema activo — sesión en progreso.</p>
   </div>`],

  ['tabla resumen de horarios de citas',
   `<div class="zoe-response">
     <h3>🕐 Resumen de Horarios — Citas de Hoy</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#2563eb;color:white"><th style="padding:8px 10px;text-align:left">Turno</th><th style="padding:8px 10px;text-align:center">Hora</th><th style="padding:8px 10px;text-align:center">Citas</th><th style="padding:8px 10px;text-align:left">Pacientes</th></tr>
       <tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">🌅 Mañana</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">07:00 - 12:00</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">2</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Ana Solis, Mario Vega</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">☀️ Tarde</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">12:00 - 18:00</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #e5e7eb">2</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">Laura Rios, Sofia Herrera</td></tr>
       <tr><td style="padding:6px 10px">🌙 Noche</td><td style="padding:6px 10px;text-align:center">18:00 - 22:00</td><td style="padding:6px 10px;text-align:center">0</td><td style="padding:6px 10px">—</td></tr>
       <tr style="background:#e8f4fd"><td style="padding:6px 10px"><strong>Total</strong></td><td style="padding:6px 10px;text-align:center">—</td><td style="padding:6px 10px;text-align:center"><strong>4</strong></td><td style="padding:6px 10px"><strong>4 pacientes</strong></td></tr>
     </table>
   </div>`],

  // ══════════════════════════════════════════════════════
  // BÚSQUEDA POR PACIENTE / DOCTOR / ESPECIALIDAD
  // ══════════════════════════════════════════════════════

  ['buscar cita de laura rios',
   `<div class="zoe-response">
     <h3>🔍 Cita de Laura Rios</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:6px 10px;text-align:left">Campo</th><th style="padding:6px 10px;text-align:left">Dato</th></tr>
       <tr><td style="padding:5px 10px">👤 Paciente</td><td style="padding:5px 10px"><strong>Laura Rios</strong></td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">👨‍⚕️ Doctor</td><td style="padding:5px 10px">Dr. Pedro Soto</td></tr>
       <tr><td style="padding:5px 10px">🏥 Especialidad</td><td style="padding:5px 10px">Medicina General</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">📅 Estado</td><td style="padding:5px 10px"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px">🔵 Activa</span></td></tr>
       <tr><td style="padding:5px 10px">⏰ Hora inicio</td><td style="padding:5px 10px">+10 min desde ahora</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">⏱️ Duración</td><td style="padding:5px 10px">30 minutos</td></tr>
       <tr><td style="padding:5px 10px">🚗 Llegada estimada</td><td style="padding:5px 10px">+1 min (llegará a tiempo)</td></tr>
     </table>
   </div>`],

  ['buscar cita de sofia herrera',
   `<div class="zoe-response">
     <h3>🔍 Cita de Sofia Herrera</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:6px 10px;text-align:left">Campo</th><th style="padding:6px 10px;text-align:left">Dato</th></tr>
       <tr><td style="padding:5px 10px">👤 Paciente</td><td style="padding:5px 10px"><strong>Sofia Herrera</strong></td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">👨‍⚕️ Doctor</td><td style="padding:5px 10px">Dra. Camila Torres</td></tr>
       <tr><td style="padding:5px 10px">🏥 Especialidad</td><td style="padding:5px 10px">Pediatría</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">📅 Estado</td><td style="padding:5px 10px"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px">🔵 Activa</span></td></tr>
       <tr><td style="padding:5px 10px">⏰ Hora inicio</td><td style="padding:5px 10px">+30 min desde ahora</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">⏱️ Duración</td><td style="padding:5px 10px">30 minutos</td></tr>
     </table>
   </div>`],

  ['buscar cita de mario vega',
   `<div class="zoe-response">
     <h3>🔍 Cita de Mario Vega</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:6px 10px;text-align:left">Campo</th><th style="padding:6px 10px;text-align:left">Dato</th></tr>
       <tr><td style="padding:5px 10px">👤 Paciente</td><td style="padding:5px 10px"><strong>Mario Vega</strong></td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">👨‍⚕️ Doctor</td><td style="padding:5px 10px">Dr. Roberto Mora</td></tr>
       <tr><td style="padding:5px 10px">🏥 Especialidad</td><td style="padding:5px 10px">Odontología</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">📅 Estado</td><td style="padding:5px 10px"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px">🔵 Activa</span></td></tr>
       <tr><td style="padding:5px 10px">⏰ Hora inicio</td><td style="padding:5px 10px">Ya comenzó (−14 min)</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">⏱️ Duración</td><td style="padding:5px 10px">30 minutos</td></tr>
     </table>
   </div>`],

  ['buscar cita de ana solis',
   `<div class="zoe-response">
     <h3>🔍 Cita de Ana Solis</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:6px 10px;text-align:left">Campo</th><th style="padding:6px 10px;text-align:left">Dato</th></tr>
       <tr><td style="padding:5px 10px">👤 Paciente</td><td style="padding:5px 10px"><strong>Ana Solis</strong></td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">👨‍⚕️ Doctor</td><td style="padding:5px 10px">Dr. Daniel Porras</td></tr>
       <tr><td style="padding:5px 10px">🏥 Especialidad</td><td style="padding:5px 10px">Cardiología</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">📅 Estado</td><td style="padding:5px 10px"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px">🔵 Activa</span></td></tr>
       <tr><td style="padding:5px 10px">⏰ Hora inicio</td><td style="padding:5px 10px">Ya comenzó (−20 min) ⚠️ tardía</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">⚠️ Nota</td><td style="padding:5px 10px">Llegada tardía — decisión: reagendar</td></tr>
     </table>
   </div>`],

  ['citas del doctor pedro soto',
   `<div class="zoe-response">
     <h3>👨‍⚕️ Agenda del Dr. Pedro Soto — Hoy</h3>
     <p><strong>Especialidad:</strong> Medicina General</p>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#2563eb;color:white"><th style="padding:6px 10px;text-align:left">Paciente</th><th style="padding:6px 10px;text-align:center">Hora</th><th style="padding:6px 10px;text-align:center">Estado</th></tr>
       <tr><td style="padding:6px 10px">Laura Rios</td><td style="padding:6px 10px;text-align:center">+10 min</td><td style="padding:6px 10px;text-align:center"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:999px;font-size:0.8em">🔵 Activa</span></td></tr>
     </table>
     <p style="margin-top:8px">Total de citas hoy: <strong>1</strong></p>
   </div>`],

  ['citas del doctor daniel porras',
   `<div class="zoe-response">
     <h3>👨‍⚕️ Agenda del Dr. Daniel Porras — Hoy</h3>
     <p><strong>Especialidad:</strong> Cardiología</p>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#2563eb;color:white"><th style="padding:6px 10px;text-align:left">Paciente</th><th style="padding:6px 10px;text-align:center">Hora</th><th style="padding:6px 10px;text-align:center">Estado</th></tr>
       <tr><td style="padding:6px 10px">Ana Solis</td><td style="padding:6px 10px;text-align:center">−20 min ⚠️</td><td style="padding:6px 10px;text-align:center"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:999px;font-size:0.8em">🔵 Activa</span></td></tr>
     </table>
     <p style="margin-top:8px">Total de citas hoy: <strong>1</strong> | ⚠️ Paciente con retraso detectado</p>
   </div>`],

  ['citas de cardiología',
   `<div class="zoe-response">
     <h3>❤️ Citas de Cardiología — Hoy</h3>
     <p><strong>Doctor:</strong> Dr. Daniel Porras</p>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#ef4444;color:white"><th style="padding:6px 10px;text-align:left">Paciente</th><th style="padding:6px 10px;text-align:center">Hora programada</th><th style="padding:6px 10px;text-align:center">Duración</th><th style="padding:6px 10px;text-align:center">Estado</th></tr>
       <tr><td style="padding:6px 10px">Ana Solis</td><td style="padding:6px 10px;text-align:center">−20 min (tardía)</td><td style="padding:6px 10px;text-align:center">30 min</td><td style="padding:6px 10px;text-align:center">🔵 Activa</td></tr>
     </table>
     <p style="margin-top:8px">Total Cardiología hoy: <strong>1 cita</strong></p>
   </div>`],

  ['citas de pediatría',
   `<div class="zoe-response">
     <h3>👶 Citas de Pediatría — Hoy</h3>
     <p><strong>Doctor:</strong> Dra. Camila Torres</p>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#8b5cf6;color:white"><th style="padding:6px 10px;text-align:left">Paciente</th><th style="padding:6px 10px;text-align:center">Hora programada</th><th style="padding:6px 10px;text-align:center">Duración</th><th style="padding:6px 10px;text-align:center">Estado</th></tr>
       <tr><td style="padding:6px 10px">Sofia Herrera</td><td style="padding:6px 10px;text-align:center">+30 min</td><td style="padding:6px 10px;text-align:center">30 min</td><td style="padding:6px 10px;text-align:center">🔵 Activa</td></tr>
     </table>
     <p style="margin-top:8px">Total Pediatría hoy: <strong>1 cita</strong></p>
   </div>`],

  ['citas de odontología',
   `<div class="zoe-response">
     <h3>🦷 Citas de Odontología — Hoy</h3>
     <p><strong>Doctor:</strong> Dr. Roberto Mora</p>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#10b981;color:white"><th style="padding:6px 10px;text-align:left">Paciente</th><th style="padding:6px 10px;text-align:center">Hora programada</th><th style="padding:6px 10px;text-align:center">Duración</th><th style="padding:6px 10px;text-align:center">Estado</th></tr>
       <tr><td style="padding:6px 10px">Mario Vega</td><td style="padding:6px 10px;text-align:center">−14 min (en curso)</td><td style="padding:6px 10px;text-align:center">30 min</td><td style="padding:6px 10px;text-align:center">🔵 Activa</td></tr>
     </table>
     <p style="margin-top:8px">Total Odontología hoy: <strong>1 cita</strong></p>
   </div>`],

  // ══════════════════════════════════════════════════════
  // PREGUNTAS CUANTITATIVAS ESPECÍFICAS
  // ══════════════════════════════════════════════════════

  ['¿cuántos doctores hay en el sistema?',
   `<div class="zoe-response">
     <h3>👨‍⚕️ Doctores Registrados en el Sistema</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:5px 10px;text-align:left">Doctor</th><th style="padding:5px 10px;text-align:left">Especialidad</th><th style="padding:5px 10px;text-align:center">Estado Hoy</th></tr>
       <tr><td style="padding:5px 10px">Dr. Pedro Soto</td><td style="padding:5px 10px">Medicina General</td><td style="padding:5px 10px;text-align:center">🟢 Activo</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Dra. Camila Torres</td><td style="padding:5px 10px">Pediatría</td><td style="padding:5px 10px;text-align:center">🟢 Activo</td></tr>
       <tr><td style="padding:5px 10px">Dr. Roberto Mora</td><td style="padding:5px 10px">Odontología</td><td style="padding:5px 10px;text-align:center">🟢 Activo</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Dr. Daniel Porras</td><td style="padding:5px 10px">Cardiología</td><td style="padding:5px 10px;text-align:center">🟢 Activo</td></tr>
     </table>
     <p style="margin-top:8px">Total de doctores: <strong>4</strong> | Todos activos hoy</p>
   </div>`],

  ['¿cuántas especialidades están disponibles?',
   `<div class="zoe-response">
     <h3>🏥 Especialidades Disponibles</h3>
     <p>Actualmente el sistema tiene <strong>4 especialidades activas</strong> con médico asignado hoy:</p>
     <ol>
       <li>❤️ <strong>Cardiología</strong> — Dr. Daniel Porras</li>
       <li>🏥 <strong>Medicina General</strong> — Dr. Pedro Soto</li>
       <li>🦷 <strong>Odontología</strong> — Dr. Roberto Mora</li>
       <li>👶 <strong>Pediatría</strong> — Dra. Camila Torres</li>
     </ol>
     <p>El sistema puede soportar más especialidades cuando se agreguen doctores adicionales.</p>
   </div>`],

  ['¿cuál es la cita más temprana de hoy?',
   `<div class="zoe-response">
     <h3>⏰ Cita Más Temprana del Día</h3>
     <p>La cita con la hora de inicio más temprana es:</p>
     <ul>
       <li>👤 <strong>Paciente:</strong> Ana Solis</li>
       <li>👨‍⚕️ <strong>Doctor:</strong> Dr. Daniel Porras</li>
       <li>🏥 <strong>Especialidad:</strong> Cardiología</li>
       <li>⏰ <strong>Hora:</strong> −20 minutos (ya comenzó)</li>
       <li>📋 <strong>Estado:</strong> 🔵 Activa</li>
     </ul>
   </div>`],

  ['¿cuál es la cita más tardía de hoy?',
   `<div class="zoe-response">
     <h3>⏰ Cita Más Tardía del Día</h3>
     <p>La cita programada para más adelante es:</p>
     <ul>
       <li>👤 <strong>Paciente:</strong> Sofia Herrera</li>
       <li>👨‍⚕️ <strong>Doctor:</strong> Dra. Camila Torres</li>
       <li>🏥 <strong>Especialidad:</strong> Pediatría</li>
       <li>⏰ <strong>Hora:</strong> +30 minutos desde ahora</li>
       <li>📋 <strong>Estado:</strong> 🔵 Activa</li>
     </ul>
   </div>`],

  ['¿hay algún paciente tardío?',
   `<div class="zoe-response">
     <h3>⚠️ Pacientes con Llegada Tardía Detectada</h3>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#fef2f2"><th style="padding:6px 10px;text-align:left">Paciente</th><th style="padding:6px 10px;text-align:left">Doctor</th><th style="padding:6px 10px;text-align:center">Retraso</th><th style="padding:6px 10px;text-align:center">Decisión</th></tr>
       <tr><td style="padding:5px 10px">Ana Solis</td><td style="padding:5px 10px">Dr. Daniel Porras</td><td style="padding:5px 10px;text-align:center">20 min</td><td style="padding:5px 10px;text-align:center">🔁 Reagendar</td></tr>
     </table>
     <p style="margin-top:8px">Los demás pacientes llegan dentro del tiempo esperado.</p>
   </div>`],

  ['tiempo promedio de espera',
   `<div class="zoe-response">
     <h3>⏱️ Tiempo Promedio de Espera</h3>
     <p>El tiempo promedio de espera por fase del flujo de atención es:</p>
     <table style="width:100%;border-collapse:collapse;margin-top:8px">
       <tr style="background:#f0f0f0"><th style="padding:5px 10px;text-align:left">Fase</th><th style="padding:5px 10px;text-align:center">Tiempo Promedio</th></tr>
       <tr><td style="padding:5px 10px">Check-in (secretaria)</td><td style="padding:5px 10px;text-align:center">2-5 minutos</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Signos vitales (enfermería)</td><td style="padding:5px 10px;text-align:center">3-7 minutos</td></tr>
       <tr><td style="padding:5px 10px">Espera antes de consulta</td><td style="padding:5px 10px;text-align:center">5-20 minutos</td></tr>
       <tr style="background:#f9f9f9"><td style="padding:5px 10px">Duración de consulta</td><td style="padding:5px 10px;text-align:center">20-45 minutos</td></tr>
       <tr style="background:#e8f4fd"><td style="padding:5px 10px"><strong>Total experiencia paciente</strong></td><td style="padding:5px 10px;text-align:center"><strong>30-77 minutos</strong></td></tr>
     </table>
   </div>`],

];


// ─── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const sdkDir = path.join(__dirname, '..', 'sdk');
  const patternsFile = path.join(sdkDir, 'zoe-learned-patterns.json');

  // Ensure sdk directory exists
  if (!fs.existsSync(sdkDir)) {
    fs.mkdirSync(sdkDir, { recursive: true });
  }

  // Load existing patterns
  let existing: PatternsFile = {};
  if (fs.existsSync(patternsFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(patternsFile, 'utf-8'));
      console.log(`📂 Cargados ${Object.keys(existing).length} patrones existentes`);
    } catch {
      console.log('⚠️  No se pudo leer el archivo de patrones existente, empezando de cero.');
    }
  }

  let added = 0;
  let updated = 0;

  for (const [query, response] of trainingData) {
    const [key, pattern] = makePattern(query, response);

    if (existing[key]) {
      // Update with higher confidence if training data is explicitly provided
      existing[key].correct_response = pattern.correct_response;
      existing[key].confidence = Math.max(existing[key].confidence, pattern.confidence);
      existing[key].feedback_count += 5;
      existing[key].last_updated = pattern.last_updated;
      updated++;
    } else {
      existing[key] = pattern;
      added++;
    }
  }

  fs.writeFileSync(patternsFile, JSON.stringify(existing, null, 2), 'utf-8');

  const total = Object.keys(existing).length;
  console.log(`✅ Entrenamiento completado:`);
  console.log(`   ➕ Nuevos patrones: ${added}`);
  console.log(`   🔄 Actualizados:    ${updated}`);
  console.log(`   📊 Total en base:   ${total}`);
  console.log(`   📁 Guardado en:     ${patternsFile}`);
}

main();
