/**
 * app/i18n/th.js — Thai.
 *
 * ⭐ Thai first because it is Ote's own language and his players' — his legacy is full of Thai
 * both in comments and in strings his players read (`หัว`/`ก้อย` on the coin, `เลขคู่`/`เลขคี่` on
 * the dice, `แต้มสูง`/`แต้มต่ำ` for high and low). Those game words are already live in
 * `app/data/coinflip.js` and `app/data/dice.js`; this file is the rest of the interface.
 *
 * ⚠️ Thai does not pluralise and does not use spaces between words, so these are NOT
 * word-for-word renderings of the English — several are shorter on purpose. That is the point of
 * a written catalogue over machine translation: a human can decide that "{count} coins" becomes
 * "{count} เหรียญ" without an "s" problem, and that a sentence reads better reordered.
 *
 * ⚠️ Any key missing here falls back to English by design, so this file can grow a line at a
 * time. `missingKeys("th")` reports the gap and a test asserts there are no STRAY keys — a
 * mistyped key name would otherwise render as itself forever.
 */
export default {
    // ── /help ────────────────────────────────────────────────────────────────
    "help.title": "MowCode Gaming Bot",
    "help.intro":
        "บอทที่เขียนไว้ตอนเป็นนักศึกษา เอามาทำใหม่ด้วย discord.js และ Postgres " +
        "ทุกคำสั่งเป็นสแลชคอมมานด์ พิมพ์ `/` แล้วรายการจะขึ้นมา",
    "help.section.economy": "เหรียญและเลเวล",
    "help.section.games": "เกม",
    "help.section.other": "อื่น ๆ",
    "help.footer": "{commands} คำสั่ง ใน {cogs} กลุ่ม · ดูรายละเอียดด้วย /help name:<คำสั่ง>",
    "help.detail.footer": "อยู่ในกลุ่ม {cog}",
    "help.unknown": "ไม่มีคำสั่งชื่อ \"{name}\" ลองใช้ /help เปล่า ๆ ดู",
    "help.options": "ตัวเลือก",
    "help.subcommands": "คำสั่งย่อย",
    "help.no_description": "ไม่มีคำอธิบาย",

    // ── /rand ────────────────────────────────────────────────────────────────
    "rand.result": "{user} คุณได้ **{value}**",
    "rand.range": "ระหว่าง {low} ถึง {high}",
    "rand.same": "ทั้งสองเลขเป็น {value} เท่ากัน ก็เลยมีคำตอบเดียว",
    "rand.credit": "ต้นฉบับคำสั่งนี้เขียนโดยมิกกี้",

    // ── /trans ───────────────────────────────────────────────────────────────
    "trans.title": "คำแปล",
    "trans.from": "ตรวจพบภาษา",
    "trans.to": "แปลเป็น",
    "trans.empty": "ใส่ข้อความที่จะแปลมาด้วย",
    "trans.too_long": "ข้อความยาว {length} ตัวอักษร เกินขีดจำกัด {max}",
    "trans.failed": "บริการแปลไม่ตอบ เพราะเป็นเอนด์พอยต์ที่ไม่ใช่ของทางการ ลองอีกครั้งอีกสักครู่",
    "trans.disabled": "การแปลถูกปิดไว้ในไฟล์ตั้งค่าของบอท",
    "trans.unknown_lang": "ไม่รู้จักรหัสภาษา \"{lang}\"",
    "trans.footer": "แปลตามคำขอผ่านเอนด์พอยต์ Google ที่ไม่ใช่ของทางการ",

    // ── /server ──────────────────────────────────────────────────────────────
    "server.title": "การตั้งค่าของ {name}",
    "server.guild_only": "คำสั่งนี้ใช้ได้ในเซิร์ฟเวอร์เท่านั้น",
    "server.language": "ภาษา",
    "server.prefix": "พรีฟิกซ์แบบเก่า",
    "server.music_channel": "ห้องเพลง",
    "server.manager_role": "โรลผู้จัดการ",
    "server.known_since": "รู้จักตั้งแต่",
    "server.not_set": "ยังไม่ตั้ง",
    "server.first_time": "เพิ่งบันทึกเซิร์ฟเวอร์นี้เป็นครั้งแรก",
    "server.lang_set": "ตั้งภาษาเป็น **{name}** (`{lang}`) แล้ว",
    "server.lang_unsupported":
        "ยังไม่มีคำแปลสำหรับ \"{lang}\" ที่มีอยู่คือ {supported} " +
        "บอทตัวนี้ใช้คำแปลที่เขียนไว้จริง ไม่ใช่แปลด้วยเครื่องเหมือนตัวเดิม",
    "server.lang_partial": "แจ้งให้ทราบ: {name} แปลไว้ {percent}% บางข้อความจะยังเป็นภาษาอังกฤษ",
    "server.prefix_set": "ตั้งพรีฟิกซ์แบบเก่าเป็น `{prefix}` แล้ว ใช้สำหรับบอกทางเท่านั้น",
    "server.needs_manage_guild": "ต้องมีสิทธิ์ Manage Server ถึงจะเปลี่ยนได้",
    "server.coverage": "ภาษาที่มีให้เลือก",

    // ── the prefix redirect ──────────────────────────────────────────────────
    "prefix.redirect": "ตอนนี้เป็น `/{command}` แล้ว พิมพ์ `/` แล้ว Discord จะขึ้นรายการให้",
    "prefix.redirect_unknown": "คำสั่งแบบ `{prefix}` เลิกใช้แล้ว ทุกอย่างเป็นสแลชคอมมานด์ ลอง `/help`",

    // ── /ping and /about ─────────────────────────────────────────────────────
    "ping.reply": "ยังอยู่ ความหน่วงเกตเวย์ {ms}ms",
    "about.title": "เกี่ยวกับบอท",
    "about.body":
        "บอทที่ทำใหม่จากตัวเดิมที่เขียนด้วย Python ช่วงปี 2021-2024 " +
        "ตัวเดิมเก็บไว้เป็นต้นแบบให้อ่านเอาความคิด ไม่ได้แปลโค้ดมาตรง ๆ",
    "about.uptime": "ออนไลน์มาแล้ว",
    "about.guilds": "เซิร์ฟเวอร์",
    "about.commands": "คำสั่ง",

    // ── /feedback ────────────────────────────────────────────────────────────
    "feedback.title": "บันทึกความเห็นแล้ว",
    "feedback.thanks": "ขอบคุณครับ ข้อความถูกเก็บลงฐานข้อมูลแล้ว ผู้ดูแลจะได้อ่าน",
    "feedback.your_message": "ข้อความของคุณ",
    "feedback.reference": "เลขอ้างอิง",
    "feedback.remaining": "ส่งได้อีกในชั่วโมงนี้",
    "feedback.private": "ข้อความนี้เห็นได้เฉพาะคุณ",
    "feedback.rate_limited":
        "ชั่วโมงนี้ส่งมาแล้ว {count} ครั้ง ครบจำนวนที่กำหนด " +
        "ข้อความก่อนหน้าไม่หายไปไหน ถ้ามีเพิ่มค่อยกลับมาอีกทีนะ",
    "feedback.too_short": "เขียนเพิ่มอีกหน่อย อย่างน้อย {min} ตัวอักษร",
    "feedback.too_long": "ข้อความยาว {length} ตัวอักษร เกิน {max} ที่กำหนด แบ่งส่งเป็นอีกครั้งได้",
    "feedback.empty": "ไม่มีข้อความส่งมา",

    // ── restart ──────────────────────────────────────────────────────────────
    "restart.countdown": "จะรีสตาร์ทในอีก {seconds}…",
    "restart.now": "รีสตาร์ทแล้ว",
    "restart.back": "กลับมาแล้ว! :D",
    "restart.no_supervisor":
        "ไม่มีตัวคุมโปรเซสอยู่ ถ้ารีสตาร์ทตอนนี้บอทจะดับไปเลย " +
        "ให้เปิดด้วย run_windows.bat (หรือ run_linux.sh) ซึ่งจะเปิดใหม่ให้เอง",

    // ── shared ───────────────────────────────────────────────────────────────
    "common.owner_only": "คำสั่งนี้ใช้ได้เฉพาะเจ้าของบอท",
    "common.something_broke": "มีอะไรพลาดตอนรันคำสั่งนี้ ระบบบันทึกไว้แล้ว",
};
