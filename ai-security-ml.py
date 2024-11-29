```python
import torch
from torch import nn
from transformers import BertTokenizer, BertModel
from sklearn.metrics import classification_report
import pandas as pd
import numpy as np

class AISecurityModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.bert = BertModel.from_pretrained('bert-base-uncased')
        self.classifier = nn.Sequential(
            nn.Linear(768, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, 4)  # 3 attack types + normal
        )
        self.severity_classifier = nn.Linear(256, 4)  # critical, high, medium, low

    def forward(self, input_ids, attention_mask):
        outputs = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        pooled_output = outputs.pooler_output
        features = self.classifier[:-1](pooled_output)
        threat_logits = self.classifier[-1](features)
        severity_logits = self.severity_classifier(features)
        return threat_logits, severity_logits

class SecurityPredictor:
    def __init__(self):
        self.tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')
        self.model = AISecurityModel()
        self.attack_types = ['normal', 'data_poisoning', 'prompt_injection', 'model_inversion']
        self.severity_levels = ['low', 'medium', 'high', 'critical']
    
    def predict(self, text):
        inputs = self.tokenizer(text, return_tensors='pt', padding=True, truncation=True)
        with torch.no_grad():
            threat_logits, severity_logits = self.model(**inputs)
            threat_probs = torch.softmax(threat_logits, dim=1)
            severity_probs = torch.softmax(severity_logits, dim=1)
            
        prediction = {
            'threat_type': self.attack_types[threat_probs.argmax().item()],
            'severity': self.severity_levels[severity_probs.argmax().item()],
            'confidence': threat_probs.max().item()
        }
        return prediction

def train_model(model, train_loader, num_epochs=5):
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-5)
    criterion = nn.CrossEntropyLoss()
    
    for epoch in range(num_epochs):
        model.train()
        for batch in train_loader:
            optimizer.zero_grad()
            threat_logits, severity_logits = model(batch['input_ids'], batch['attention_mask'])
            loss = criterion(threat_logits, batch['threat_labels']) + \
                   criterion(severity_logits, batch['severity_labels'])
            loss.backward()
            optimizer.step()

# API for frontend integration
from fastapi import FastAPI
app = FastAPI()

@app.post("/analyze")
async def analyze_threat(text: str):
    predictor = SecurityPredictor()
    return predictor.predict(text)
```
