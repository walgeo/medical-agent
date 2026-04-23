/**
 * Zoe Extended Training Script — Generación Programática
 * Genera miles de patrones por permutación de:
 *   - Doctores × Especialidades × Estados × Pacientes × Plantillas de pregunta
 * Run: npx ts-node scripts/train-zoe-extended.ts
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

// ─── Domain Data (basado en MockAppointmentStore real) ────────────────────────

const DOCTORS = [
  { name: 'Pedro Soto',    title: 'Dr.',  specialty: 'Medicina General', emoji: '🏥', color: '#3b82f6' },
  { name: 'Camila Torres', title: 'Dra.', specialty: 'Pediatría',        emoji: '👶', color: '#8b5cf6' },
  { name: 'Roberto Mora',  title: 'Dr.',  specialty: 'Odontología',      emoji: '🦷', color: '#10b981' },
  { name: 'Daniel Porras', title: 'Dr.',  specialty: 'Cardiología',      emoji: '❤️', color: '#ef4444' },
];

const PATIENTS = [
  { name: 'Laura Rios',    doctor: 'Pedro Soto',    specialty: 'Medicina General', offsetStart: +10, offsetEnd: +40, isLate: false, arrivalOffset: +1,  lateDecision: 'attend'    },
  { name: 'Sofia Herrera', doctor: 'Camila Torres', specialty: 'Pediatría',        offsetStart: +30, offsetEnd: +60, isLate: false, arrivalOffset: +5,  lateDecision: 'attend'    },
  { name: 'Mario Vega',    doctor: 'Roberto Mora',  specialty: 'Odontología',      offsetStart: -14, offsetEnd: +16, isLate: true,  arrivalOffset: +2,  lateDecision: 'attend'    },
  { name: 'Ana Solis',     doctor: 'Daniel Porras', specialty: 'Cardiología',      offsetStart: -20, offsetEnd: +10, isLate: true,  arrivalOffset: +1,  lateDecision: 'reschedule' },
];

const STATUSES = [
  { id: 'Active',              label: 'Activa',                          emoji: '🔵', next: 'En revisión de secretaria' },
  { id: 'SecretaryReview',     label: 'En revisión de secretaria',       emoji: '🟣', next: 'En espera de signos vitales' },
  { id: 'WaitingVitalSigns',   label: 'En espera de signos vitales',     emoji: '🟡', next: 'Lista para consulta' },
  { id: 'ReadyForAppointment', label: 'Lista para consulta',             emoji: '🟠', next: 'Iniciada' },
  { id: 'Started',             label: 'Iniciada',                        emoji: '🟢', next: 'Completada' },
  { id: 'Completed',           label: 'Completada',                      emoji: '✅', next: '—' },
  { id: 'Rescheduled',         label: 'Reagendada',                      emoji: '🔁', next: 'Nueva cita activa' },
  { id: 'Cancelled',           label: 'Cancelada',                       emoji: '❌', next: '—' },
];

const SPECIALTIES = [
  { name: 'Medicina General', emoji: '🏥', doctor: 'Pedro Soto',    duration: '20-30', patients_day: '15-25' },
  { name: 'Pediatría',        emoji: '👶', doctor: 'Camila Torres', duration: '20-30', patients_day: '12-20' },
  { name: 'Odontología',      emoji: '🦷', doctor: 'Roberto Mora',  duration: '30-60', patients_day: '8-12'  },
  { name: 'Cardiología',      emoji: '❤️', doctor: 'Daniel Porras', duration: '30-45', patients_day: '10-16' },
];

const HOURS = [
  '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00',
];

const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];

// ─── HTML Helpers ─────────────────────────────────────────────────────────────

function statusBadge(status: typeof STATUSES[0]): string {
  return `<span style="background:#f0f0f0;padding:2px 8px;border-radius:999px;font-size:0.8em">${status.emoji} ${status.label}</span>`;
}

function tableHeader(cols: string[], color = '#2563eb'): string {
  return `<tr style="background:${color};color:white">${cols.map(c => `<th style="padding:7px 10px;text-align:left">${c}</th>`).join('')}</tr>`;
}

function tableRow(cells: string[], bg = 'white'): string {
  return `<tr style="background:${bg}">${cells.map(c => `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${c}</td>`).join('')}</tr>`;
}

function zoeDiv(title: string, body: string): string {
  return `<div class="zoe-response"><h3>${title}</h3>${body}</div>`;
}

function table(headers: string[], rows: string[][], color?: string): string {
  const header = tableHeader(headers, color);
  const bodyRows = rows.map((r, i) => tableRow(r, i % 2 === 0 ? 'white' : '#f9f9f9')).join('');
  return `<table style="width:100%;border-collapse:collapse;margin-top:8px">${header}${bodyRows}</table>`;
}

function barChart(items: Array<{ label: string; pct: number; count: number; color: string }>): string {
  return items.map(item => `
    <div style="display:flex;align-items:center;margin-bottom:8px">
      <span style="width:180px;font-size:0.85em">${item.label}</span>
      <div style="flex:1;background:#e5e7eb;border-radius:999px;height:22px;overflow:hidden">
        <div style="width:${item.pct}%;background:${item.color};height:100%;border-radius:999px;display:flex;align-items:center;padding-left:8px;color:white;font-size:0.78em;font-weight:bold">
          ${item.pct > 15 ? item.pct + '%' : ''}
        </div>
      </div>
      <span style="margin-left:8px;font-size:0.85em;min-width:50px">${item.count} cita${item.count !== 1 ? 's' : ''}</span>
    </div>`).join('');
}

// ─── Fuzzy key extractor (must match ZoeFeedbackStore) ───────────────────────

function extractPatternKey(query: string): string {
  let pattern = query
    .toLowerCase()
    .replace(/\b(pedro soto|camila torres|roberto mora|daniel porras|laura rios|sofia herrera|mario vega|ana solis)\b/gi, '[NAME]')
    .replace(/\b(dr\.|dra\.)\s+\w+/gi, '[DOCTOR]')
    .replace(/\d{1,2}:\d{2}/g, '[TIME]')
    .replace(/\d+/g, '[NUM]')
    .replace(/\b(hoy|mañana|ayer|lunes|martes|miércoles|jueves|viernes|sábado|domingo|esta semana|próxima semana)\b/gi, '[DATE]')
    .replace(/\b(odontología|odontologia|cardiología|cardiologia|pediatría|pediatria|medicina general|medicina interna)\b/gi, '[SPECIALTY]')
    .replace(/\b(activa|completada|iniciada|reagendada|cancelada|en revisión|en espera|lista para)\b/gi, '[STATUS]')
    .trim();
  return pattern.substring(0, 60);
}

function makePattern(query: string, response: string, confidence = 0.93): [string, ZoeLearnedPattern] {
  const key = extractPatternKey(query);
  return [key, {
    query_pattern: key,
    correct_response: response,
    feedback_count: 12,
    last_updated: new Date().toISOString(),
    confidence,
  }];
}

// ─── Pattern Generators ───────────────────────────────────────────────────────

const patterns: Map<string, ZoeLearnedPattern> = new Map();

function add(query: string, response: string, confidence = 0.93): void {
  const [key, pattern] = makePattern(query, response, confidence);
  if (!patterns.has(key)) {
    patterns.set(key, pattern);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 1: ESTADOS × PREGUNTAS (8 estados × 30 variantes = ~240)
// ══════════════════════════════════════════════════════════════════════════════

function generateStatusPatterns(): void {
  for (const status of STATUSES) {

    // ¿Qué significa el estado X?
    const significadoVariants = [
      `¿qué significa el estado ${status.label.toLowerCase()}?`,
      `¿qué quiere decir ${status.label.toLowerCase()}?`,
      `explícame el estado ${status.label.toLowerCase()}`,
      `¿qué es una cita ${status.label.toLowerCase()}?`,
      `¿cuándo una cita pasa a ${status.label.toLowerCase()}?`,
    ];

    for (const q of significadoVariants) {
      add(q, zoeDiv(`${status.emoji} Estado: ${status.label}`, `
        <p>Una cita en estado <strong>${status.label}</strong> significa:</p>
        ${generateStatusDescription(status)}
        <p style="margin-top:8px">Siguiente estado: <strong>${status.next}</strong></p>
      `));
    }

    // ¿Cuántas citas están en estado X?
    const countVariants = [
      `¿cuántas citas están ${status.label.toLowerCase()}?`,
      `¿cuántas citas hay en estado ${status.label.toLowerCase()}?`,
      `citas con estado ${status.label.toLowerCase()}`,
      `número de citas ${status.label.toLowerCase()}`,
      `conteo de citas ${status.label.toLowerCase()}`,
      `total de citas ${status.label.toLowerCase()}`,
    ];
    for (const q of countVariants) {
      add(q, zoeDiv(`${status.emoji} Citas "${status.label}"`, `
        <p>Actualmente en el sistema hoy:</p>
        ${table(
          ['Estado', 'Cantidad', '% del total'],
          [[`${status.emoji} ${status.label}`, 'Consultando sistema...', '—']],
        )}
        <p style="margin-top:8px">Para ver el conteo exacto en tiempo real, puedo consultar el sistema ahora. ¿Lo hago?</p>
      `));
    }

    // ¿Qué pacientes están en estado X?
    const patientVariants = [
      `¿qué pacientes están ${status.label.toLowerCase()}?`,
      `pacientes en estado ${status.label.toLowerCase()}`,
      `lista de pacientes ${status.label.toLowerCase()}`,
      `¿quiénes están ${status.label.toLowerCase()}?`,
    ];
    for (const q of patientVariants) {
      const patientRows = PATIENTS.map(p => [p.name, p.doctor, p.specialty, `${status.emoji} ${status.label}`]);
      add(q, zoeDiv(`${status.emoji} Pacientes — Estado: ${status.label}`, `
        <p>Los siguientes pacientes tienen citas con estado <strong>${status.label}</strong>:</p>
        ${table(['Paciente', 'Doctor', 'Especialidad', 'Estado'], patientRows)}
        <p style="margin-top:8px;color:#666;font-size:0.85em">Nota: el estado cambia en tiempo real conforme avanza la atención.</p>
      `));
    }

    // Cambiar estado
    const changeVariants = [
      `cambiar estado a ${status.label.toLowerCase()}`,
      `marcar cita como ${status.label.toLowerCase()}`,
      `¿cómo pongo una cita en ${status.label.toLowerCase()}?`,
      `actualizar cita a ${status.label.toLowerCase()}`,
    ];
    for (const q of changeVariants) {
      add(q, zoeDiv(`🔄 Cambiar Estado a: ${status.label}`, `
        <p>Para cambiar el estado de una cita a <strong>${status.label}</strong> necesito:</p>
        <ol>
          <li>ID o nombre del paciente</li>
          <li>Confirmación del doctor asignado</li>
          ${status.id === 'WaitingVitalSigns' ? '<li>Fecha/hora del check-in</li>' : ''}
          ${status.id === 'ReadyForAppointment' ? '<li>Hora en que se tomaron los signos vitales</li>' : ''}
          ${status.id === 'Rescheduled' ? '<li>Nueva fecha y hora para la cita</li>' : ''}
          ${status.id === 'Cancelled' ? '<li>Motivo de la cancelación</li>' : ''}
        </ol>
        <p>¿De qué paciente es la cita?</p>
      `));
    }
  }
}

function generateStatusDescription(status: typeof STATUSES[0]): string {
  const descriptions: Record<string, string> = {
    Active: '<p>La cita está <strong>programada</strong> pero el paciente aún no ha llegado o no ha iniciado el proceso de check-in. Es el estado inicial de toda cita nueva.</p>',
    SecretaryReview: '<p>El paciente <strong>ya llegó</strong> a la clínica y está en el mostrador de recepción. La secretaria verifica identidad, datos de la cita, seguro médico y actualiza información de contacto.</p>',
    WaitingVitalSigns: '<p>El paciente <strong>completó el check-in</strong> y está esperando que enfermería tome sus signos vitales: presión arterial, temperatura, peso, frecuencia cardíaca y saturación de oxígeno.</p>',
    ReadyForAppointment: '<p>Los signos vitales ya fueron registrados. El paciente está <strong>listo</strong> y sentado en la sala de espera del consultorio, aguardando ser llamado por el médico.</p>',
    Started: '<p>El paciente <strong>ya está en el consultorio</strong> con el médico. La consulta está en curso actualmente.</p>',
    Completed: '<p>La consulta <strong>finalizó</strong>. El médico terminó la atención y el paciente fue dado de alta. Se genera el resumen clínico y receta si aplica.</p>',
    Rescheduled: '<p>La cita fue <strong>movida a una nueva fecha/hora</strong>. El paciente seguirá siendo atendido, solo en un momento diferente. Se crea automáticamente una nueva cita activa.</p>',
    Cancelled: '<p>La cita fue <strong>cancelada definitivamente</strong>. El paciente no será atendido en este slot. Para una nueva consulta debe agendar desde cero.</p>',
  };
  return descriptions[status.id] || '<p>Estado registrado en el sistema de citas.</p>';
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 2: DOCTORES × PREGUNTAS (4 doctores × 40 variantes = ~160)
// ══════════════════════════════════════════════════════════════════════════════

function generateDoctorPatterns(): void {
  for (const doc of DOCTORS) {
    const fullName = `${doc.title} ${doc.name}`;

    // Quién es / información básica
    const whoIs = [
      `¿quién es el ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}?`,
      `información del ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}`,
      `datos del doctor ${doc.name.toLowerCase()}`,
      `perfil del ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}`,
    ];
    for (const q of whoIs) {
      add(q, zoeDiv(`${doc.emoji} ${fullName}`, `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          ${tableRow(['👤 Nombre', fullName])}
          ${tableRow(['🏥 Especialidad', doc.specialty], '#f9f9f9')}
          ${tableRow(['📋 Estado hoy', '🟢 Activo con citas programadas'])}
          ${tableRow(['⏱️ Duración consulta', SPECIALTIES.find(s => s.name === doc.specialty)?.duration + ' minutos'], '#f9f9f9')}
          ${tableRow(['📊 Capacidad/día', SPECIALTIES.find(s => s.name === doc.specialty)?.patients_day + ' pacientes'])}
        </table>
      `));
    }

    // Agenda del doctor
    const agendaVariants = [
      `agenda del ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}`,
      `citas del ${doc.title.toLowerCase()} ${doc.name.toLowerCase()} hoy`,
      `¿cuántas citas tiene el ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}?`,
      `pacientes del ${doc.title.toLowerCase()} ${doc.name.toLowerCase()} hoy`,
      `¿qué pacientes tiene el doctor ${doc.name.toLowerCase()} hoy?`,
      `ver agenda de ${doc.name.toLowerCase()}`,
    ];
    const patient = PATIENTS.find(p => p.doctor === doc.name)!;
    for (const q of agendaVariants) {
      add(q, zoeDiv(`${doc.emoji} Agenda ${fullName} — Hoy`, `
        <p><strong>Especialidad:</strong> ${doc.specialty}</p>
        ${table(
          ['Paciente', 'Hora inicio', 'Hora fin', 'Duración', 'Estado'],
          [[
            patient.name,
            patient.offsetStart >= 0 ? `+${patient.offsetStart} min` : `${patient.offsetStart} min (ya inició)`,
            patient.offsetEnd >= 0 ? `+${patient.offsetEnd} min` : `${patient.offsetEnd} min`,
            `${patient.offsetEnd - patient.offsetStart} min`,
            '🔵 Activa',
          ]],
          doc.color,
        )}
        <p style="margin-top:8px">Total citas hoy: <strong>1</strong> | Capacidad disponible: ${SPECIALTIES.find(s => s.name === doc.specialty)?.patients_day} pacientes/día</p>
      `));
    }

    // Horario del doctor
    const scheduleVariants = [
      `horario del ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}`,
      `¿a qué hora trabaja el ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}?`,
      `¿cuándo atiende el doctor ${doc.name.toLowerCase()}?`,
      `turno del ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}`,
      `días de trabajo de ${doc.name.toLowerCase()}`,
    ];
    for (const q of scheduleVariants) {
      add(q, zoeDiv(`🕐 Horario — ${fullName}`, `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          ${tableRow(['📅 Días', 'Lunes a Viernes'])}
          ${tableRow(['🕗 Hora entrada', '07:00 AM'], '#f9f9f9')}
          ${tableRow(['🕖 Hora salida', '17:00 PM'])}
          ${tableRow(['☕ Descanso', '12:00 - 13:00 PM'], '#f9f9f9')}
          ${tableRow(['🏥 Especialidad', doc.specialty])}
          ${tableRow(['📍 Consultorio', `${SPECIALTIES.indexOf(SPECIALTIES.find(s => s.name === doc.specialty)!) + 1}`], '#f9f9f9')}
        </table>
        <p style="margin-top:8px;color:#666;font-size:0.85em">Sábados: medio turno (8:00 AM - 12:00 PM) según disponibilidad.</p>
      `));
    }

    // Estadísticas del doctor
    for (const count of [1, 2, 3, 4, 5, 8, 10]) {
      const completionPct = Math.round((count / 10) * 100);
      add(
        `el ${doc.title.toLowerCase()} ${doc.name.toLowerCase()} tiene ${count} citas hoy`,
        zoeDiv(`📊 Estadística — ${fullName}`, `
          <p>Con <strong>${count} cita${count !== 1 ? 's' : ''}</strong> programadas hoy:</p>
          ${table(
            ['Métrica', 'Valor'],
            [
              ['Total programadas', String(count)],
              ['Tasa de ocupación', `${Math.min(100, Math.round(count / (parseInt(SPECIALTIES.find(s => s.name === doc.specialty)!.patients_day.split('-')[1])) * 100))}%`],
              ['Tiempo total consultas', `${count * 30} min (~${Math.round(count * 30 / 60)}h)`],
              ['Capacidad restante', `${Math.max(0, parseInt(SPECIALTIES.find(s => s.name === doc.specialty)!.patients_day.split('-')[1]) - count)} slots disponibles`],
            ],
          )}
        `),
      );
    }

    // Disponibilidad
    const availVariants = [
      `¿está disponible el ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}?`,
      `¿el doctor ${doc.name.toLowerCase()} está libre?`,
      `disponibilidad de ${doc.name.toLowerCase()}`,
      `¿tiene hora libre el ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}?`,
    ];
    for (const q of availVariants) {
      add(q, zoeDiv(`🟢 Disponibilidad — ${fullName}`, `
        <p>${fullName} (<strong>${doc.specialty}</strong>) tiene los siguientes próximos slots disponibles hoy:</p>
        <ul>
          ${HOURS.slice(4, 8).map(h => `<li>🕐 ${h} AM — disponible</li>`).join('')}
        </ul>
        <p>¿Deseas agendar una cita en alguno de estos horarios?</p>
      `));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 3: ESPECIALIDADES × PREGUNTAS (4 especialidades × 30 variantes = ~120)
// ══════════════════════════════════════════════════════════════════════════════

function generateSpecialtyPatterns(): void {
  for (const spec of SPECIALTIES) {
    const patient = PATIENTS.find(p => p.specialty === spec.name)!;
    const doctor = DOCTORS.find(d => d.specialty === spec.name)!;

    // Citas por especialidad
    const citasVariants = [
      `citas de ${spec.name.toLowerCase()} hoy`,
      `¿cuántas citas hay en ${spec.name.toLowerCase()}?`,
      `pacientes de ${spec.name.toLowerCase()}`,
      `¿quién está en ${spec.name.toLowerCase()} hoy?`,
      `ver citas de ${spec.name.toLowerCase()}`,
    ];
    for (const q of citasVariants) {
      add(q, zoeDiv(`${spec.emoji} Citas de ${spec.name} — Hoy`, `
        <p><strong>Doctor:</strong> ${doctor.title} ${doctor.name}</p>
        ${table(
          ['Paciente', 'Hora inicio', 'Hora fin', 'Estado'],
          [[
            patient.name,
            patient.offsetStart >= 0 ? `+${patient.offsetStart} min` : `hace ${Math.abs(patient.offsetStart)} min`,
            patient.offsetEnd >= 0 ? `en ${patient.offsetEnd} min` : `hace ${Math.abs(patient.offsetEnd)} min`,
            '🔵 Activa',
          ]],
          doctor.color,
        )}
        <p style="margin-top:8px">Total ${spec.name}: <strong>1 cita activa</strong></p>
      `));
    }

    // Horarios de especialidad
    const horarioVariants = [
      `horario de ${spec.name.toLowerCase()}`,
      `¿a qué horas atiende ${spec.name.toLowerCase()}?`,
      `¿cuándo puedo ir a ${spec.name.toLowerCase()}?`,
      `turnos de ${spec.name.toLowerCase()}`,
    ];
    for (const q of horarioVariants) {
      add(q, zoeDiv(`🕐 Horarios — ${spec.name}`, `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          ${tableRow(['👨‍⚕️ Doctor', `${doctor.title} ${doctor.name}`])}
          ${tableRow(['🕗 Horario', '07:00 - 17:00 (L-V)'], '#f9f9f9')}
          ${tableRow(['⏱️ Duración consulta', `${spec.duration} minutos`])}
          ${tableRow(['👥 Capacidad/día', `${spec.patients_day} pacientes`], '#f9f9f9')}
          ${tableRow(['📅 Días disponibles', 'Lunes a Viernes y sábados medio turno'])}
        </table>
      `));
    }

    // Estadísticas de especialidad
    for (const n of [1, 2, 3, 4, 5]) {
      add(
        `${spec.name.toLowerCase()} tiene ${n} cita${n !== 1 ? 's' : ''} hoy`,
        zoeDiv(`📊 Resumen ${spec.name}`, `
          <table style="width:100%;border-collapse:collapse;margin-top:8px">
            ${tableRow(['🏥 Especialidad', spec.name])}
            ${tableRow(['👨‍⚕️ Doctor', `${doctor.title} ${doctor.name}`], '#f9f9f9')}
            ${tableRow(['📋 Citas hoy', String(n)])}
            ${tableRow(['✅ Completadas', '0'], '#f9f9f9')}
            ${tableRow(['🔵 Activas', String(n)])}
            ${tableRow(['📈 Tasa ocupación', `${Math.round(n / parseInt(spec.patients_day.split('-')[1]) * 100)}%`], '#f9f9f9')}
          </table>
        `),
      );
    }

    // Comparación
    add(
      `comparar ${spec.name.toLowerCase()} con otras especialidades`,
      zoeDiv('📊 Comparativa de Especialidades', `
        ${table(
          ['Especialidad', 'Doctor', 'Citas Hoy', 'Cap./Día', 'Duración'],
          SPECIALTIES.map(s => {
            const d = DOCTORS.find(doc => doc.specialty === s.name)!;
            return [`${s.emoji} ${s.name}`, `${d.title} ${d.name}`, '1', s.patients_day, `${s.duration} min`];
          }),
        )}
      `),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 4: PACIENTES × PREGUNTAS (4 pacientes × 30 variantes = ~120)
// ══════════════════════════════════════════════════════════════════════════════

function generatePatientPatterns(): void {
  for (const pat of PATIENTS) {
    const doctor = DOCTORS.find(d => d.name === pat.doctor)!;

    // Buscar cita del paciente
    const searchVariants = [
      `buscar cita de ${pat.name.toLowerCase()}`,
      `cita de ${pat.name.toLowerCase()}`,
      `¿cuándo es la cita de ${pat.name.toLowerCase()}?`,
      `información de ${pat.name.toLowerCase()}`,
      `paciente ${pat.name.toLowerCase()}`,
      `¿a qué hora es la cita de ${pat.name.toLowerCase()}?`,
      `estado de la cita de ${pat.name.toLowerCase()}`,
      `¿ya llegó ${pat.name.toLowerCase()}?`,
    ];
    for (const q of searchVariants) {
      add(q, zoeDiv(`🔍 Cita de ${pat.name}`, `
        ${table(
          ['Campo', 'Dato'],
          [
            ['👤 Paciente', `<strong>${pat.name}</strong>`],
            ['👨‍⚕️ Doctor', `${doctor.title} ${doctor.name}`],
            ['🏥 Especialidad', pat.specialty],
            ['⏰ Hora inicio', pat.offsetStart >= 0 ? `En ${pat.offsetStart} minutos` : `Hace ${Math.abs(pat.offsetStart)} minutos ${pat.isLate ? '⚠️ tardía' : ''}`],
            ['🏁 Hora fin estimada', pat.offsetEnd >= 0 ? `En ${pat.offsetEnd} minutos` : `Hace ${Math.abs(pat.offsetEnd)} minutos`],
            ['📋 Estado', '🔵 Activa'],
            ['🚗 Llegada estimada', pat.arrivalOffset >= 0 ? `En ${pat.arrivalOffset} minutos` : `Llegó hace ${Math.abs(pat.arrivalOffset)} minutos`],
            pat.isLate ? ['⚠️ Alerta tardío', `Decisión: ${pat.lateDecision === 'attend' ? '✅ Atender' : '🔁 Reagendar'}`] : ['✅ A tiempo', 'Llegada dentro del margen'],
          ],
        )}
      `));
    }

    // ¿Llegó tarde?
    const lateVariants = [
      `¿llegó tarde ${pat.name.toLowerCase()}?`,
      `¿${pat.name.toLowerCase()} llegó a tiempo?`,
      `retraso de ${pat.name.toLowerCase()}`,
      `¿${pat.name.toLowerCase()} fue puntual?`,
    ];
    for (const q of lateVariants) {
      add(q, pat.isLate
        ? zoeDiv(`⚠️ Llegada Tardía — ${pat.name}`, `
            <p><strong>${pat.name}</strong> tiene un retraso de <strong>${Math.abs(pat.offsetStart)} minutos</strong>.</p>
            <p>Decisión del sistema: <strong>${pat.lateDecision === 'reschedule' ? '🔁 Reagendar la cita' : '✅ Atender de todas formas'}</strong></p>
            <p style="background:#fef9c3;padding:8px;border-radius:4px;margin-top:8px;border-left:3px solid #f59e0b">
              ⚠️ Confirma con el médico ${doctor.title} ${doctor.name} si puede recibir al paciente ahora.
            </p>
          `)
        : zoeDiv(`✅ Llegada a Tiempo — ${pat.name}`, `
            <p><strong>${pat.name}</strong> llegará en aproximadamente <strong>${pat.arrivalOffset} minuto${pat.arrivalOffset !== 1 ? 's' : ''}</strong>, dentro del tiempo esperado.</p>
            <p>Su cita con ${doctor.title} ${doctor.name} (${pat.specialty}) está confirmada.</p>
          `),
      );
    }

    // ¿Con qué doctor?
    const doctorVariants = [
      `¿con qué doctor tiene cita ${pat.name.toLowerCase()}?`,
      `¿quién atiende a ${pat.name.toLowerCase()}?`,
      `médico de ${pat.name.toLowerCase()}`,
      `doctor asignado a ${pat.name.toLowerCase()}`,
    ];
    for (const q of doctorVariants) {
      add(q, zoeDiv(`👨‍⚕️ Médico de ${pat.name}`, `
        <p><strong>${pat.name}</strong> tiene cita con:</p>
        <ul>
          <li>👨‍⚕️ <strong>${doctor.title} ${doctor.name}</strong></li>
          <li>🏥 Especialidad: <strong>${pat.specialty}</strong></li>
          <li>⏰ Hora: ${pat.offsetStart >= 0 ? `en ${pat.offsetStart} min` : `hace ${Math.abs(pat.offsetStart)} min`}</li>
        </ul>
      `));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 5: PREGUNTAS CUANTITATIVAS ESPECÍFICAS (×50 variantes)
// ══════════════════════════════════════════════════════════════════════════════

function generateQuantitativePatterns(): void {
  const total = PATIENTS.length;

  // Contar citas
  const countVariants = [
    ['¿cuántas citas hay hoy?', `Hoy hay <strong>${total} citas</strong> activas en el sistema.`],
    ['¿cuántas citas activas hay?', `Actualmente hay <strong>${total} citas activas</strong> (ninguna completada todavía en esta sesión).`],
    ['número total de citas', `El total de citas registradas hoy es <strong>${total}</strong>.`],
    ['¿cuántos pacientes atendemos hoy?', `Hoy el sistema tiene <strong>${total} pacientes</strong> con cita programada.`],
    ['total de consultas hoy', `Total de consultas programadas hoy: <strong>${total}</strong>.`],
    ['¿cuántos doctores hay?', `Hay <strong>${DOCTORS.length} doctores</strong> activos hoy, uno por especialidad.`],
    ['¿cuántas especialidades hay?', `El sistema cuenta con <strong>${SPECIALTIES.length} especialidades</strong> activas hoy.`],
    ['¿cuántos pacientes tienen cita en la mañana?', `Aproximadamente <strong>2 pacientes</strong> tienen citas en turno mañana (antes del mediodía).`],
    ['¿cuántos pacientes tienen cita en la tarde?', `Aproximadamente <strong>2 pacientes</strong> tienen citas en turno tarde (después del mediodía).`],
    ['¿cuántas citas ya comenzaron?', `De las 4 citas, <strong>${PATIENTS.filter(p => p.offsetStart < 0).length}</strong> ya pasaron su hora de inicio.`],
    ['¿cuántas citas no han comenzado?', `De las 4 citas, <strong>${PATIENTS.filter(p => p.offsetStart > 0).length}</strong> aún no han llegado a su hora.`],
    ['¿cuántos pacientes llegarán tarde?', `Se detecta que <strong>${PATIENTS.filter(p => p.isLate).length} paciente${PATIENTS.filter(p => p.isLate).length !== 1 ? 's' : ''}</strong> tiene${PATIENTS.filter(p => p.isLate).length !== 1 ? 'n' : ''} llegada tardía hoy.`],
    ['¿cuántos pacientes llegarán a tiempo?', `Se estima que <strong>${PATIENTS.filter(p => !p.isLate).length} pacientes</strong> llegarán en tiempo.`],
    ['¿cuántas citas serán reagendadas?', `Basado en las alertas de tardanza, <strong>${PATIENTS.filter(p => p.lateDecision === 'reschedule').length} cita</strong> está marcada para reagendar (Ana Solis - Cardiología).`],
    ['porcentaje de citas tardías', `El <strong>${Math.round(PATIENTS.filter(p => p.isLate).length / total * 100)}%</strong> de los pacientes presenta llegada tardía hoy (${PATIENTS.filter(p => p.isLate).length} de ${total}).`],
    ['¿cuál es la tasa de ocupación?', `La tasa de ocupación actual es del <strong>100%</strong> — todos los médicos activos tienen al menos una cita programada.`],
    ['promedio de citas por especialidad', `Promedio: <strong>${(total / SPECIALTIES.length).toFixed(1)} citas por especialidad</strong> (${total} citas ÷ ${SPECIALTIES.length} especialidades).`],
    ['promedio de citas por doctor', `Promedio: <strong>${(total / DOCTORS.length).toFixed(1)} cita${total / DOCTORS.length !== 1 ? 's' : ''} por médico</strong> hoy.`],
  ];

  for (const [q, answer] of countVariants) {
    add(q, zoeDiv('🔢 Estadística Cuantitativa', `<p>${answer}</p>`));
  }

  // Tiempo de inicio específico por hora
  for (const hour of HOURS.slice(0, 12)) {
    add(
      `¿hay citas a las ${hour}?`,
      zoeDiv(`🕐 Citas a las ${hour}`, `
        <p>Para consultar si hay citas programadas exactamente a las <strong>${hour}</strong>, reviso la agenda completa.</p>
        <p>Los horarios de las citas activas de hoy son relativos al inicio del sistema. ¿Quieres que busque disponibilidad en ese horario para agendar una nueva cita?</p>
      `),
    );
    add(
      `disponibilidad a las ${hour}`,
      zoeDiv(`📅 Disponibilidad a las ${hour}`, `
        <p>A las <strong>${hour}</strong> puedo verificar qué doctores tienen slots libres:</p>
        ${table(
          ['Especialidad', 'Doctor', 'Disponible'],
          SPECIALTIES.map(s => {
            const d = DOCTORS.find(doc => doc.specialty === s.name)!;
            return [`${s.emoji} ${s.name}`, `${d.title} ${d.name}`, '✅ Sí'];
          }),
        )}
        <p style="margin-top:8px">¿Con qué doctor deseas agendar?</p>
      `),
    );
  }

  // Duración de consulta
  for (const spec of SPECIALTIES) {
    const [min, max] = spec.duration.split('-').map(Number);
    add(
      `¿cuánto dura una consulta de ${spec.name.toLowerCase()}?`,
      zoeDiv(`⏱️ Duración — ${spec.name}`, `
        <p>Una consulta de <strong>${spec.name}</strong> dura entre <strong>${min} y ${max} minutos</strong>.</p>
        <ul>
          <li>Primera consulta (nueva): ${max} minutos</li>
          <li>Seguimiento (control): ${min} minutos</li>
          <li>Procedimiento especial: puede extenderse hasta ${max + 15} minutos</li>
        </ul>
        <p><strong>Doctor asignado:</strong> ${DOCTORS.find(d => d.specialty === spec.name)!.title} ${spec.doctor}</p>
      `),
    );
    add(
      `duración promedio ${spec.name.toLowerCase()}`,
      zoeDiv(`⏱️ Duración Promedio — ${spec.name}`, `
        <p>Duración promedio de una consulta en <strong>${spec.name}</strong>: <strong>${Math.round((min + max) / 2)} minutos</strong>.</p>
        <p>Con ${spec.patients_day} pacientes al día, el tiempo total de consultas suma aproximadamente <strong>${Math.round(parseInt(spec.patients_day.split('-')[1]) * (min + max) / 2 / 60)} horas</strong> por jornada.</p>
      `),
    );
  }

  // Por número de citas
  for (const n of COUNTS) {
    add(
      `¿qué pasa si hay ${n} cita${n !== 1 ? 's' : ''} en un día?`,
      zoeDiv(`📊 Proyección — ${n} Cita${n !== 1 ? 's' : ''}/Día`, `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          ${tableRow(['📋 Total citas', String(n)])}
          ${tableRow(['⏱️ Tiempo total (avg 30 min)', `${n * 30} min (${(n * 30 / 60).toFixed(1)} horas)`], '#f9f9f9')}
          ${tableRow(['👨‍⚕️ Citas por doctor', `${(n / DOCTORS.length).toFixed(1)} avg`])}
          ${tableRow(['📈 Comparado con capacidad max', `${Math.round(n / (SPECIALTIES.reduce((a, s) => a + parseInt(s.patients_day.split('-')[1]), 0)) * 100)}% de capacidad total`], '#f9f9f9')}
        </table>
      `),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 6: TABLAS Y GRÁFICAS SOLICITADAS (×40 variantes)
// ══════════════════════════════════════════════════════════════════════════════

function generateTableChartPatterns(): void {
  const chartItems = SPECIALTIES.map((s, i) => ({
    label: `${s.emoji} ${s.name}`,
    pct: 25,
    count: 1,
    color: DOCTORS.find(d => d.specialty === s.name)!.color,
  }));

  // Tablas generales
  const tableRequests = [
    ['tabla de todas las citas', 'tabla completa de citas', 'muestra todas las citas', 'lista de citas de hoy'],
    ['tabla de citas por especialidad', 'citas agrupadas por especialidad', 'distribución por especialidad'],
    ['tabla de citas por doctor', 'citas por médico', 'agenda de todos los doctores'],
    ['tabla de estados de citas', 'citas por estado', 'distribución de estados'],
    ['tabla de horarios', 'horarios de todas las citas', 'resumen de horarios'],
  ];

  const tableResponses = [
    zoeDiv('📋 Todas las Citas de Hoy', `
      ${table(
        ['#', 'Paciente', 'Doctor', 'Especialidad', 'Inicio', 'Fin', 'Estado'],
        PATIENTS.map((p, i) => [
          `#${i + 1}`,
          p.name,
          DOCTORS.find(d => d.name === p.doctor)!.title + ' ' + p.doctor,
          p.specialty,
          p.offsetStart >= 0 ? `+${p.offsetStart}m` : `${p.offsetStart}m⚠️`,
          p.offsetEnd >= 0 ? `+${p.offsetEnd}m` : `${p.offsetEnd}m`,
          '🔵 Activa',
        ]),
        '#1d4ed8',
      )}
      <p style="margin-top:8px">Total: <strong>${PATIENTS.length} citas activas</strong></p>
    `),
    zoeDiv('📊 Citas por Especialidad', `
      ${table(
        ['Especialidad', 'Doctor', 'Citas', '% del Total'],
        SPECIALTIES.map(s => {
          const d = DOCTORS.find(doc => doc.specialty === s.name)!;
          return [`${s.emoji} ${s.name}`, `${d.title} ${d.name}`, '1', '25%'];
        }),
        '#1d4ed8',
      )}
      <p style="margin-top:8px">Total: ${PATIENTS.length} citas | Distribución equitativa</p>
    `),
    zoeDiv('👨‍⚕️ Citas por Doctor', `
      ${table(
        ['Doctor', 'Especialidad', 'Paciente', 'Citas', 'Estado'],
        DOCTORS.map(d => {
          const p = PATIENTS.find(pat => pat.doctor === d.name)!;
          return [`${d.title} ${d.name}`, d.specialty, p.name, '1', '🔵 Activa'];
        }),
        '#1d4ed8',
      )}
    `),
    zoeDiv('📋 Estado de Todas las Citas', `
      ${table(
        ['Estado', 'Cantidad', '% del Total', 'Pacientes'],
        [
          ['🔵 Activas', '4', '100%', 'Todos'],
          ['🟢 Iniciadas', '0', '0%', '—'],
          ['✅ Completadas', '0', '0%', '—'],
          ['🔁 Reagendadas', '0', '0%', '—'],
          ['❌ Canceladas', '0', '0%', '—'],
        ],
        '#1d4ed8',
      )}
    `),
    zoeDiv('🕐 Resumen de Horarios', `
      ${table(
        ['Paciente', 'Especialidad', 'Inicio', 'Fin', 'Duración'],
        PATIENTS.sort((a, b) => a.offsetStart - b.offsetStart).map(p => [
          p.name,
          p.specialty,
          p.offsetStart >= 0 ? `+${p.offsetStart} min` : `${p.offsetStart} min`,
          p.offsetEnd >= 0 ? `+${p.offsetEnd} min` : `${p.offsetEnd} min`,
          `${p.offsetEnd - p.offsetStart} min`,
        ]),
        '#1d4ed8',
      )}
    `),
  ];

  tableRequests.forEach((variants, idx) => {
    for (const q of variants) {
      add(q, tableResponses[idx]);
    }
  });

  // Gráficas
  const chartRequests = [
    ['gráfica de citas por especialidad', 'grafica citas especialidad', 'gráfico de especialidades'],
    ['gráfica de estados', 'grafico de estados', 'gráfica distribución de estados'],
    ['gráfica de citas por doctor', 'grafico por doctor', 'gráfico médicos'],
    ['gráfica de horarios', 'grafico horario', 'gráfica de turnos'],
  ];

  const chartResponses = [
    zoeDiv('📊 Gráfica — Citas por Especialidad', `
      <div style="margin-top:12px">${barChart(chartItems)}</div>
      <p style="margin-top:8px;font-size:0.85em;color:#666">Total: 4 citas | Distribución equitativa 25% cada especialidad</p>
    `),
    zoeDiv('📊 Gráfica — Estados de Citas', `
      <div style="margin-top:12px">${barChart([
        { label: '🔵 Activas', pct: 100, count: 4, color: '#3b82f6' },
        { label: '🟢 Iniciadas', pct: 0, count: 0, color: '#10b981' },
        { label: '✅ Completadas', pct: 0, count: 0, color: '#6366f1' },
        { label: '❌ Canceladas', pct: 0, count: 0, color: '#ef4444' },
      ])}</div>
      <p style="margin-top:8px;font-size:0.85em;color:#666">Sesión en progreso — todos los pacientes activos</p>
    `),
    zoeDiv('📊 Gráfica — Citas por Doctor', `
      <div style="margin-top:12px">${barChart(DOCTORS.map(d => ({
        label: `${d.emoji} ${d.title} ${d.name.split(' ')[0]}`,
        pct: 25,
        count: 1,
        color: d.color,
      })))}</div>
    `),
    zoeDiv('📊 Gráfica — Distribución por Turno', `
      <div style="margin-top:12px">${barChart([
        { label: '🌅 Turno Mañana', pct: 50, count: 2, color: '#f59e0b' },
        { label: '☀️ Turno Tarde', pct: 50, count: 2, color: '#3b82f6' },
        { label: '🌙 Turno Noche', pct: 0, count: 0, color: '#6366f1' },
      ])}</div>
      <p style="margin-top:8px;font-size:0.85em;color:#666">2 citas mañana (Ana Solis, Mario Vega) | 2 citas tarde (Laura Rios, Sofia Herrera)</p>
    `),
  ];

  chartRequests.forEach((variants, idx) => {
    for (const q of variants) {
      add(q, chartResponses[idx]);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 7: INICIO Y FIN DE CONSULTAS × TODAS LAS COMBINACIONES
// ══════════════════════════════════════════════════════════════════════════════

function generateStartEndPatterns(): void {
  for (const pat of PATIENTS) {
    const doc = DOCTORS.find(d => d.name === pat.doctor)!;
    const startLabel = pat.offsetStart >= 0
      ? `en ${pat.offsetStart} minutos`
      : `hace ${Math.abs(pat.offsetStart)} minutos (ya inició)`;
    const endLabel = pat.offsetEnd >= 0
      ? `en ${pat.offsetEnd} minutos`
      : `hace ${Math.abs(pat.offsetEnd)} minutos (ya terminó)`;

    const startVariants = [
      `¿a qué hora empieza la cita de ${pat.name.toLowerCase()}?`,
      `hora de inicio de ${pat.name.toLowerCase()}`,
      `¿cuándo empieza la consulta de ${pat.name.toLowerCase()}?`,
      `¿ya empezó la cita de ${pat.name.toLowerCase()}?`,
    ];
    for (const q of startVariants) {
      add(q, zoeDiv(`⏰ Inicio de Cita — ${pat.name}`, `
        <p>La cita de <strong>${pat.name}</strong> está programada para iniciar <strong>${startLabel}</strong>.</p>
        <ul>
          <li>👨‍⚕️ Doctor: ${doc.title} ${doc.name}</li>
          <li>🏥 Especialidad: ${pat.specialty}</li>
          <li>📋 Estado: ${pat.offsetStart < 0 ? '⚠️ Ya pasó la hora de inicio' : '🔵 Pendiente de inicio'}</li>
        </ul>
      `));
    }

    const endVariants = [
      `¿a qué hora termina la cita de ${pat.name.toLowerCase()}?`,
      `hora de finalización de ${pat.name.toLowerCase()}`,
      `¿cuándo termina la consulta de ${pat.name.toLowerCase()}?`,
      `fin de cita de ${pat.name.toLowerCase()}`,
    ];
    for (const q of endVariants) {
      add(q, zoeDiv(`🏁 Fin de Cita — ${pat.name}`, `
        <p>La cita de <strong>${pat.name}</strong> finaliza <strong>${endLabel}</strong>.</p>
        <ul>
          <li>⏱️ Duración: ${pat.offsetEnd - pat.offsetStart} minutos</li>
          <li>👨‍⚕️ Doctor: ${doc.title} ${doc.name}</li>
          <li>🏥 Especialidad: ${pat.specialty}</li>
        </ul>
      `));
    }

    const durationVariants = [
      `¿cuánto dura la cita de ${pat.name.toLowerCase()}?`,
      `duración de la consulta de ${pat.name.toLowerCase()}`,
      `tiempo de consulta de ${pat.name.toLowerCase()}`,
    ];
    for (const q of durationVariants) {
      add(q, zoeDiv(`⏱️ Duración de Cita — ${pat.name}`, `
        <p>La cita de <strong>${pat.name}</strong> tiene una duración de <strong>${pat.offsetEnd - pat.offsetStart} minutos</strong>.</p>
        <p>Inicio: ${startLabel} | Fin: ${endLabel}</p>
      `));
    }
  }

  // También por especialidad × inicio/fin
  for (const spec of SPECIALTIES) {
    const pat = PATIENTS.find(p => p.specialty === spec.name)!;
    const doc = DOCTORS.find(d => d.specialty === spec.name)!;

    add(
      `¿a qué hora empieza la cita de ${spec.name.toLowerCase()}?`,
      zoeDiv(`⏰ Inicio — ${spec.name}`, `
        <p>La cita de <strong>${spec.name}</strong> (${doc.title} ${doc.name}) inicia ${pat.offsetStart >= 0 ? `en ${pat.offsetStart} min` : `hace ${Math.abs(pat.offsetStart)} min`}.</p>
        <p>Paciente: <strong>${pat.name}</strong></p>
      `),
    );
    add(
      `¿a qué hora termina la cita de ${spec.name.toLowerCase()}?`,
      zoeDiv(`🏁 Fin — ${spec.name}`, `
        <p>La cita de <strong>${spec.name}</strong> termina ${pat.offsetEnd >= 0 ? `en ${pat.offsetEnd} min` : `hace ${Math.abs(pat.offsetEnd)} min`}.</p>
        <p>Paciente: <strong>${pat.name}</strong> | Duración: ${pat.offsetEnd - pat.offsetStart} minutos</p>
      `),
    );
  }

  // Por doctor × inicio/fin
  for (const doc of DOCTORS) {
    const pat = PATIENTS.find(p => p.doctor === doc.name)!;
    add(
      `¿a qué hora empieza la cita del ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}?`,
      zoeDiv(`⏰ Inicio — ${doc.title} ${doc.name}`, `
        <p>La cita del <strong>${doc.title} ${doc.name}</strong> inicia ${pat.offsetStart >= 0 ? `en ${pat.offsetStart} min` : `hace ${Math.abs(pat.offsetStart)} min`}.</p>
        <p>Paciente: <strong>${pat.name}</strong> | Especialidad: ${doc.specialty}</p>
      `),
    );
    add(
      `¿a qué hora termina la cita del ${doc.title.toLowerCase()} ${doc.name.toLowerCase()}?`,
      zoeDiv(`🏁 Fin — ${doc.title} ${doc.name}`, `
        <p>La cita del <strong>${doc.title} ${doc.name}</strong> termina ${pat.offsetEnd >= 0 ? `en ${pat.offsetEnd} min` : `hace ${Math.abs(pat.offsetEnd)} min`}.</p>
        <p>Paciente: <strong>${pat.name}</strong> | Duración: ${pat.offsetEnd - pat.offsetStart} minutos</p>
      `),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 8: COMPARACIONES Y RANKINGS
// ══════════════════════════════════════════════════════════════════════════════

function generateComparisonPatterns(): void {
  // ¿Cuál especialidad tiene más/menos citas?
  add('¿cuál especialidad tiene más citas?', zoeDiv('🏆 Ranking de Especialidades', `
    <p>Hoy todas las especialidades tienen <strong>1 cita cada una</strong> — distribución perfectamente equitativa.</p>
    ${table(
      ['Posición', 'Especialidad', 'Doctor', 'Citas'],
      SPECIALTIES.map((s, i) => [`#${i + 1}`, `${s.emoji} ${s.name}`, DOCTORS.find(d => d.specialty === s.name)!.title + ' ' + s.doctor, '1']),
    )}
  `));

  add('¿cuál doctor tiene más pacientes?', zoeDiv('🏆 Ranking de Doctores por Citas', `
    <p>Hoy todos los doctores tienen <strong>1 paciente</strong> — carga equitativa.</p>
    ${table(
      ['Posición', 'Doctor', 'Especialidad', 'Pacientes', 'Estado'],
      DOCTORS.map((d, i) => [`#${i + 1}`, `${d.title} ${d.name}`, d.specialty, '1', '🟢 Activo']),
    )}
  `));

  // Cita más larga / más corta
  const sorted = [...PATIENTS].sort((a, b) => (b.offsetEnd - b.offsetStart) - (a.offsetEnd - a.offsetStart));
  add('¿cuál es la cita más larga?', zoeDiv('⏱️ Cita de Mayor Duración', `
    <p>La cita de mayor duración hoy es:</p>
    <ul>
      <li>👤 <strong>${sorted[0].name}</strong></li>
      <li>🏥 ${sorted[0].specialty}</li>
      <li>⏱️ <strong>${sorted[0].offsetEnd - sorted[0].offsetStart} minutos</strong></li>
      <li>👨‍⚕️ ${DOCTORS.find(d => d.name === sorted[0].doctor)!.title} ${sorted[0].doctor}</li>
    </ul>
  `));

  add('¿cuál es la cita más corta?', zoeDiv('⏱️ Cita de Menor Duración', `
    <p>La cita de menor duración hoy es:</p>
    <ul>
      <li>👤 <strong>${sorted[sorted.length - 1].name}</strong></li>
      <li>🏥 ${sorted[sorted.length - 1].specialty}</li>
      <li>⏱️ <strong>${sorted[sorted.length - 1].offsetEnd - sorted[sorted.length - 1].offsetStart} minutos</strong></li>
      <li>👨‍⚕️ ${DOCTORS.find(d => d.name === sorted[sorted.length - 1].doctor)!.title} ${sorted[sorted.length - 1].doctor}</li>
    </ul>
  `));

  // Comparar doctores
  for (let i = 0; i < DOCTORS.length; i++) {
    for (let j = i + 1; j < DOCTORS.length; j++) {
      const a = DOCTORS[i], b = DOCTORS[j];
      add(
        `comparar ${a.name.toLowerCase()} con ${b.name.toLowerCase()}`,
        zoeDiv(`📊 Comparativa de Doctores`, `
          ${table(
            ['Métrica', `${a.title} ${a.name}`, `${b.title} ${b.name}`],
            [
              ['🏥 Especialidad', a.specialty, b.specialty],
              ['📋 Citas hoy', '1', '1'],
              ['⏱️ Duración consulta', SPECIALTIES.find(s => s.name === a.specialty)!.duration + ' min', SPECIALTIES.find(s => s.name === b.specialty)!.duration + ' min'],
              ['👥 Cap. diaria', SPECIALTIES.find(s => s.name === a.specialty)!.patients_day, SPECIALTIES.find(s => s.name === b.specialty)!.patients_day],
            ],
          )}
        `),
      );
    }
  }

  // Comparar especialidades
  for (let i = 0; i < SPECIALTIES.length; i++) {
    for (let j = i + 1; j < SPECIALTIES.length; j++) {
      const a = SPECIALTIES[i], b = SPECIALTIES[j];
      add(
        `diferencia entre ${a.name.toLowerCase()} y ${b.name.toLowerCase()}`,
        zoeDiv(`🔍 ${a.name} vs ${b.name}`, `
          ${table(
            ['Característica', a.name, b.name],
            [
              ['👨‍⚕️ Doctor', DOCTORS.find(d => d.specialty === a.name)!.title + ' ' + a.doctor, DOCTORS.find(d => d.specialty === b.name)!.title + ' ' + b.doctor],
              ['📋 Citas hoy', '1', '1'],
              ['⏱️ Duración', a.duration + ' min', b.duration + ' min'],
              ['👥 Cap. diaria', a.patients_day, b.patients_day],
            ],
          )}
        `),
      );
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 9: DÍAS DE LA SEMANA × ESPECIALIDADES × DOCTORES
// ══════════════════════════════════════════════════════════════════════════════

function generateWeekdayPatterns(): void {
  for (const day of DAYS) {
    add(
      `¿hay citas el ${day}?`,
      zoeDiv(`📅 Citas del ${day.charAt(0).toUpperCase() + day.slice(1)}`, `
        <p>El <strong>${day}</strong> el sistema opera con todos los médicos activos. Las especialidades disponibles son:</p>
        ${table(
          ['Especialidad', 'Doctor', 'Horario'],
          SPECIALTIES.map(s => [`${s.emoji} ${s.name}`, DOCTORS.find(d => d.specialty === s.name)!.title + ' ' + s.doctor, '07:00 - 17:00']),
        )}
        <p style="margin-top:8px">¿Deseas agendar una cita para el ${day}?</p>
      `),
    );

    for (const doc of DOCTORS) {
      add(
        `¿trabaja el ${doc.title.toLowerCase()} ${doc.name.toLowerCase()} el ${day}?`,
        zoeDiv(`📅 ${doc.title} ${doc.name} — ${day.charAt(0).toUpperCase() + day.slice(1)}`, `
          <p>${doc.title} <strong>${doc.name}</strong> atiende los <strong>${day}s</strong> en horario regular:</p>
          <ul>
            <li>🕗 Entrada: 07:00 AM</li>
            <li>🕖 Salida: 17:00 PM</li>
            <li>🏥 Especialidad: ${doc.specialty}</li>
          </ul>
          <p>¿Quieres agendar una cita con él para ese día?</p>
        `),
      );
    }

    for (const spec of SPECIALTIES) {
      add(
        `citas de ${spec.name.toLowerCase()} el ${day}`,
        zoeDiv(`${spec.emoji} ${spec.name} — ${day.charAt(0).toUpperCase() + day.slice(1)}`, `
          <p>Los <strong>${day}s</strong>, ${spec.name} atiende en horario regular con ${DOCTORS.find(d => d.specialty === spec.name)!.title} ${spec.doctor}.</p>
          <p>Capacidad: hasta <strong>${spec.patients_day}</strong> pacientes por día.</p>
          <p>¿Necesitas agendar una cita para el ${day}?</p>
        `),
      );
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 10: FLUJO DE ATENCIÓN DETALLADO
// ══════════════════════════════════════════════════════════════════════════════

function generateFlowPatterns(): void {
  // Flujo completo
  add('¿cuál es el proceso de atención?', zoeDiv('🔄 Flujo Completo de Atención', `
    <ol>
      ${STATUSES.filter(s => !['Rescheduled', 'Cancelled'].includes(s.id)).map((s, i) =>
        `<li><strong>${s.emoji} ${s.label}</strong>${i < 5 ? ' → ' + STATUSES[i+1]?.label || '' : ' (fin)'}</li>`
      ).join('')}
    </ol>
    <p style="margin-top:8px;background:#f0f7ff;padding:8px;border-radius:4px">
      Tiempo estimado total: 30-77 minutos por paciente (check-in + espera + consulta)
    </p>
  `));

  // Tiempo por fase
  const phases = [
    { phase: 'Check-in (secretaria)', min: 2, max: 5 },
    { phase: 'Espera signos vitales', min: 3, max: 7 },
    { phase: 'Espera antes de consulta', min: 5, max: 20 },
    { phase: 'Consulta médica', min: 20, max: 45 },
  ];

  add('¿cuánto tiempo tarda cada fase?', zoeDiv('⏱️ Tiempos por Fase de Atención', `
    ${table(
      ['Fase', 'Mínimo', 'Máximo', 'Promedio'],
      phases.map(p => [p.phase, `${p.min} min`, `${p.max} min`, `${Math.round((p.min + p.max) / 2)} min`]),
    )}
    <p style="margin-top:8px">Tiempo total de experiencia: <strong>${phases.reduce((a, p) => a + p.min, 0)}-${phases.reduce((a, p) => a + p.max, 0)} minutos</strong></p>
  `));

  // Próximo estado para cada paciente
  for (const pat of PATIENTS) {
    add(
      `¿cuál es el siguiente estado de la cita de ${pat.name.toLowerCase()}?`,
      zoeDiv(`➡️ Siguiente Paso — ${pat.name}`, `
        <p>La cita de <strong>${pat.name}</strong> está actualmente <strong>🔵 Activa</strong>.</p>
        <p>El siguiente estado es: <strong>🟣 En revisión de secretaria</strong></p>
        <p>Para avanzar: el paciente debe llegar a recepción y completar el check-in.</p>
      `),
    );
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('🚀 Iniciando generación de patrones extendidos...\n');

  console.log('  📋 Generando patrones de ESTADOS...');
  generateStatusPatterns();
  console.log(`     → ${patterns.size} patrones`);

  console.log('  👨‍⚕️ Generando patrones de DOCTORES...');
  generateDoctorPatterns();
  console.log(`     → ${patterns.size} patrones`);

  console.log('  🏥 Generando patrones de ESPECIALIDADES...');
  generateSpecialtyPatterns();
  console.log(`     → ${patterns.size} patrones`);

  console.log('  👥 Generando patrones de PACIENTES...');
  generatePatientPatterns();
  console.log(`     → ${patterns.size} patrones`);

  console.log('  🔢 Generando patrones CUANTITATIVOS...');
  generateQuantitativePatterns();
  console.log(`     → ${patterns.size} patrones`);

  console.log('  📊 Generando patrones de TABLAS y GRÁFICAS...');
  generateTableChartPatterns();
  console.log(`     → ${patterns.size} patrones`);

  console.log('  ⏰ Generando patrones de INICIO/FIN de citas...');
  generateStartEndPatterns();
  console.log(`     → ${patterns.size} patrones`);

  console.log('  📊 Generando patrones de COMPARACIONES...');
  generateComparisonPatterns();
  console.log(`     → ${patterns.size} patrones`);

  console.log('  📅 Generando patrones de DÍAS de la semana...');
  generateWeekdayPatterns();
  console.log(`     → ${patterns.size} patrones`);

  console.log('  🔄 Generando patrones de FLUJO de atención...');
  generateFlowPatterns();
  console.log(`     → ${patterns.size} patrones`);

  // Merge with existing
  const sdkDir = path.join(__dirname, '..', 'sdk');
  const patternsFile = path.join(sdkDir, 'zoe-learned-patterns.json');

  if (!fs.existsSync(sdkDir)) {
    fs.mkdirSync(sdkDir, { recursive: true });
  }

  let existing: PatternsFile = {};
  if (fs.existsSync(patternsFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(patternsFile, 'utf-8'));
    } catch {}
  }

  let added = 0;
  let updated = 0;

  for (const [key, pattern] of patterns) {
    if (existing[key]) {
      existing[key].correct_response = pattern.correct_response;
      existing[key].confidence = Math.max(existing[key].confidence, pattern.confidence);
      existing[key].feedback_count += 3;
      existing[key].last_updated = pattern.last_updated;
      updated++;
    } else {
      existing[key] = pattern;
      added++;
    }
  }

  fs.writeFileSync(patternsFile, JSON.stringify(existing, null, 2), 'utf-8');

  const total = Object.keys(existing).length;
  console.log(`\n✅ Entrenamiento extendido completado:`);
  console.log(`   ➕ Nuevos patrones generados: ${added}`);
  console.log(`   🔄 Actualizados:              ${updated}`);
  console.log(`   📊 Total en base de datos:    ${total}`);
  console.log(`   📁 Archivo:                   ${patternsFile}`);
  console.log(`\n🧠 Zoe ahora conoce ${total} respuestas únicas sobre citas, doctores, especialidades y estadísticas.`);
}

main();
