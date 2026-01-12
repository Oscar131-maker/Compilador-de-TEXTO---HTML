from fastapi import FastAPI, HTTPException, Body, Depends, status
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import re
import os
import uuid
from dotenv import load_dotenv

# Load env variables for local dev
load_dotenv()

# --- Configuration & Auth ---
SECRET_KEY = os.getenv("SECRET_KEY", "CHANGE_THIS_IN_PRODUCTION_SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours

# Credentials from ENV
ADMIN_USERNAME_ENV = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_ENV = os.getenv("ADMIN_PASSWORD", "password123")

# Database Configuration
# Uses DATABASE_URL if in Railway/Prod, else local SQLite
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sql_app.db")
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLAlchemy Setup
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Database Models ---
class TemplateDB(Base):
    __tablename__ = "templates"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, index=True)
    content = Column(Text)

# Create Tables
Base.metadata.create_all(bind=engine)

# --- Pydantic Models ---
class TemplateBase(BaseModel):
    name: str
    content: str

class Template(TemplateBase):
    id: str
    class Config:
        orm_mode = True

class Token(BaseModel):
    access_token: str
    token_type: str

class GenerationRequest(BaseModel):
    template_content: str
    input_text: str

# --- Auth Security ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/token")

app = FastAPI()

# Add CORS for broader compatibility if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helpers
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        if username != ADMIN_USERNAME_ENV: # In a real DB user system, check DB
             raise credentials_exception
    except JWTError:
        raise credentials_exception
    return username

def parse_text_replacements(text: str) -> Dict[str, str]:
    replacements = {}
    lines = text.split('\n')
    ignored_keys = {
        "SPAN", "DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", 
        "A", "IMG", "UL", "LI", "SECTION", "HEADER", "FOOTER", "BODY", "HTML",
        "SCRIPT", "STYLE", "BR", "HR"
    }
    for line in lines:
        line = line.strip()
        match = re.search(r'^\*\*(.+?):\*\*\s*(.*)', line)
        if match:
            key = match.group(1).strip()
            value = match.group(2).strip()
            if key in ignored_keys: continue
            replacements[key] = value
    return replacements

# --- Endpoints ---

@app.post("/api/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    # Simple check against Env Vars
    if form_data.username != ADMIN_USERNAME_ENV or form_data.password != ADMIN_PASSWORD_ENV:
         raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": form_data.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/templates", response_model=List[Template])
def get_templates(db: Session = Depends(get_db), current_user: str = Depends(get_current_user)):
    return db.query(TemplateDB).all()

@app.post("/api/templates", response_model=Template)
def create_template(template: TemplateBase, db: Session = Depends(get_db), current_user: str = Depends(get_current_user)):
    db_template = TemplateDB(
        id=str(uuid.uuid4()),
        name=template.name,
        content=template.content
    )
    db.add(db_template)
    db.commit()
    db.refresh(db_template)
    return db_template

@app.put("/api/templates/{template_id}", response_model=Template)
def update_template(template_id: str, template: TemplateBase, db: Session = Depends(get_db), current_user: str = Depends(get_current_user)):
    db_template = db.query(TemplateDB).filter(TemplateDB.id == template_id).first()
    if not db_template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    db_template.name = template.name
    db_template.content = template.content
    db.commit()
    db.refresh(db_template)
    return db_template

@app.delete("/api/templates/{template_id}")
def delete_template(template_id: str, db: Session = Depends(get_db), current_user: str = Depends(get_current_user)):
    db_template = db.query(TemplateDB).filter(TemplateDB.id == template_id).first()
    if not db_template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    db.delete(db_template)
    db.commit()
    return {"message": "Template deleted"}

@app.post("/api/generate")
def generate_html(request: GenerationRequest, current_user: str = Depends(get_current_user)):
    html_content = request.template_content
    replacements = parse_text_replacements(request.input_text)
    
    count = 0
    for key, value in replacements.items():
        if key in html_content:
            html_content = html_content.replace(key, value)
            count += 1
            
    return {
        "generated_html": html_content,
        "replacements_count": count
    }

# Serve Login and App
@app.get("/login")
def serve_login():
    return StaticFiles(directory="static").get_response("login.html", scope={"type": "http"})

# Mount Static as default for other paths
# Order matters: simpler to just serve /static and root
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
